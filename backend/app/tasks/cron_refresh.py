"""Periodic store refresh — meant to run as a Railway Cron service.

The numbered steps below run in order — each wrapped in its own try/except
(one step failing logs and moves on; it does NOT abort the rest, since with
restartPolicyType = "NEVER" a hard-abort just means the whole refresh waits 8
hours). Interleaved with them are the career-page DRIFT DETECTORS (see
app/services/ops_alert.py): feed_died + career_url_moved right after step 1,
links_broken inside step 3's scan, url_scheme_changed inside step 1's upsert
path — each Telegrams the operator (deduped) when a company's career site
moves or changes its URL scheme:

  1. ``ingest_featured_ats`` — two-phase pull of every featured company's ATS
     feed into the store (see job_ingest.py's docstring for the phase split).
     Phase 2 (render + SPA-sniff) only runs when CRON_RENDER=1, and records a
     compat verdict straight from its own render result for every company it
     touches — there's no separate compat-probe step anymore, since that
     would just redo the same render/sniff work a moment later.
  2. ``embed_backfill`` — vectorize any job still missing its embedding, so
     it's reachable by semantic search (shared with the admin ingest trigger
     — see app/services/embed_backfill.py).
  3. a link-health scan over a RANDOM sample of the featured cache — validate
     job URLs and log the broken/suspect ones (mirrors POST /monitor/scan,
     minus the admin HTTP hop). Random, not a fixed prefix slice, so every
     job gets a turn across enough runs instead of only ever checking the
     same first 300.
  4. prune promoted landing pages whose backing job just went inactive.
  5. ``purge_dead`` — hard-DELETE jobs that have stayed dead past a grace
     window (~3 cycles). Live jobs are never touched; a job only ages out once
     it's been gone from every feed long enough that a transient miss is ruled
     out (see app/db/jobs.py::purge_dead). This is the "if the link dies, delete
     it — don't keep churning status" model: search hides a dead job the moment
     it leaves the feed (step 1's liveness diff), then this step removes the row.

The whole run is capped by an overall timeout (_TOTAL_TIMEOUT) — a stuck
render/DB call fails the run instead of blocking the next 8h cycle forever.

Runs as a ONE-OFF process (starts, works, exits) — exactly Railway's cron model.
No HTTP, no admin token: it calls the service layer directly. Needs the same
env as the web service (DATABASE_URL, GEMINI_API_KEY, …), plus:
  CRON_RENDER=1        — enable phase 2 (render + SPA-sniff) for companies
                         phase 1 left empty. Off by default (cheap-pass only).
  CRON_RENDER_LIMIT     — cap how many phase-1-empty companies phase 2
                         renders this run (unset = all of them). Meant for a
                         controlled first rollout, not steady-state use.
  CRON_DEAD_GRACE_HOURS — how long a job stays gone before it's hard-deleted
                         (default 20 ≈ 3 cycles). Larger = more forgiving of
                         transient outages, slower to shed dead rows.

Invoke (Railway cron "Custom Start Command", WORKDIR /app):
    python -m app.tasks.cron_refresh
"""
from __future__ import annotations

import asyncio
import logging
import os
import random

from app.services import incidents as incidents_svc

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cron_refresh")

# How many featured job URLs to health-check per run (bounded — keep the cron short).
_SCAN_LIMIT = int(os.getenv("CRON_SCAN_LIMIT", "300"))
_SCAN_CONCURRENCY = 12
_TOTAL_TIMEOUT = 90 * 60  # hard ceiling for the whole run; cadence is 8h
# A dead job (left its feed / apply-gate found it dead) is hard-DELETED once it
# has stayed gone this long — ~3 cron cycles at 8h, so a 1-cycle transient miss
# reactivates instead of being deleted. See jobs.purge_dead.
_DEAD_GRACE_HOURS = int(os.getenv("CRON_DEAD_GRACE_HOURS", "20"))


_DRIFT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def _mostly_broken(checked: int, broken: int) -> bool:
    """Per-company link-scan verdict: small samples need unanimity, bigger
    ones a supermajority — either way it reads "the site's URL format died",
    not "a few postings closed"."""
    return (checked >= 3 and broken == checked) or (checked >= 5 and broken / checked >= 0.6)


async def _diagnose_feed_death(career_url: str) -> str:
    """One cheap probe → the root-cause class for a feed_died alert, from the
    taxonomy every dead feed so far has fallen into: site unreachable,
    anti-bot wall, whole-site migration (host redirect), dead endpoint, or
    "page alive → API/adapter drift or genuinely 0 VN openings" (DSV/Ogilvy)."""
    import httpx
    from urllib.parse import urlparse

    def _host(u: str) -> str:
        return (urlparse(u).netloc or "").lower().removeprefix("www.")

    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True,
                                     headers={"User-Agent": _DRIFT_UA}) as client:
            r = await client.get(career_url)
    except Exception as e:  # noqa: BLE001
        return (f"career_url không truy cập được ({type(e).__name__}) — "
                f"site chết hoặc chặn IP tầng mạng")
    low = (r.text or "")[:20000].lower()
    if r.status_code in (403, 429) or "just a moment" in low or "cf-browser-verification" in low:
        return (f"HTTP {r.status_code} + dấu hiệu anti-bot — chặn scanner/IP "
                f"(link có thể vẫn sống với người dùng); thử /debug/fetch từ IP VN")
    final = _host(str(r.url))
    if final and final != _host(career_url):
        return (f"career_url redirect sang host khác: {final} — site đã migrate, "
                f"cần cập nhật career_url + adapter (bài Ahamove)")
    if r.status_code >= 400:
        return f"HTTP {r.status_code} — endpoint chết, site có thể đổi cấu trúc URL"
    return ("trang career vẫn sống (200, cùng host) — hoặc API/adapter lệch "
            "(đổi format, bài GHN) hoặc công ty hết job VN thật (bài DSV)")


async def _career_url_drift(empty_names: set | None = None) -> dict:
    """Detect featured career_url pages that now redirect to a DIFFERENT host —
    the "whole site migrated" class (Ahamove: ahamove.com/recruitment →
    careers.ahamove.com). Only the redirect target is judged: fetch errors are
    ignored here (feed_died's turf), and a 4xx final page still shows its host.
    Same-host redirects (path moves, / → /careers) are normal and stay quiet.

    `empty_names` scopes the probe to companies whose feed came back EMPTY this
    run: big boards often keep a vanity page that redirects away while the feed
    behind the configured URL stays alive (TikTok → lifeattiktok, Bosch/Accor
    on SmartRecruiters, Google, Salesforce — all fired as false "moved" on the
    first prod cycle). A redirect only matters when the feed is ALSO gone.
    None (ingest crashed, no signal) → probe everything, as before."""
    import httpx
    from urllib.parse import urlparse

    from app.data.featured_companies import FEATURED_COMPANIES
    from app.services import ops_alert

    def _host(u: str) -> str:
        return (urlparse(u).netloc or "").lower().removeprefix("www.")

    targets = [c for c in FEATURED_COMPANIES
               if empty_names is None or c.name in empty_names]
    sem = asyncio.Semaphore(10)
    moved: list[tuple] = []

    async with httpx.AsyncClient(timeout=10, follow_redirects=True,
                                 headers={"User-Agent": _DRIFT_UA}) as client:
        async def probe(c) -> None:
            async with sem:
                try:
                    r = await client.get(c.career_url)
                except Exception:  # noqa: BLE001 — unreachable is not "moved"
                    return
            final = _host(str(r.url))
            if final and final != _host(c.career_url):
                moved.append((c, final))

        await asyncio.gather(*[probe(c) for c in targets],
                             return_exceptions=True)

    for c, final in moved:
        await ops_alert.alert(
            "career_url_moved", c.name,
            f"career_url giờ redirect sang host khác: {_host(c.career_url)} → {final}. "
            f"Cập nhật career_url trong featured_companies + kiểm tra adapter còn đọc đúng nguồn.",
            fingerprint=f"career_url_moved:{c.name}:{final}", ttl_days=30,
            context={"career_url": c.career_url, "final_host": final},
        )
    return {"probed": len(targets), "moved": len(moved)}


async def _link_scan() -> dict:
    """Validate a random sample of featured job URLs and log broken/suspect
    ones. Self-contained mirror of the /monitor/scan route (no admin dep).

    Random sample, not jobs[:_SCAN_LIMIT] — a fixed prefix slice would only
    ever re-check the same first N URLs every run (stably ordered cache),
    leaving everything past that index never health-checked."""
    from app.routers.career import _read_featured_entry
    from app.services import link_health

    # cache.get_json swallows its own errors and returns None either way, so
    # an empty read here is ambiguous: "no cache yet" (fine) vs. "Redis had a
    # transient timeout" (should retry, not silently report a 0-job scan as
    # if it were a clean, complete run — this has been observed live: a
    # single Upstash read timeout zeroed out the whole scan for a cycle).
    # One short retry is cheap and fixes the common transient case; if the
    # cache is genuinely empty it just costs an extra ~cheap read.
    entry = await _read_featured_entry()
    if not entry:
        await asyncio.sleep(2)
        entry = await _read_featured_entry()
        if not entry:
            logger.warning("[cron] link scan: featured cache read empty after retry — "
                           "either genuinely no cache yet, or Redis is unreachable")
    companies = (entry or {}).get("companies") or []
    jobs: list[dict] = []
    for c in companies:
        cname = c.get("name", "")
        for j in c.get("jobs", []):
            url = (j.get("url") or "").strip()
            if url:
                jobs.append({"url": url, "title": j.get("title", ""), "company": cname})
    jobs = random.sample(jobs, min(len(jobs), _SCAN_LIMIT))

    sem = asyncio.Semaphore(_SCAN_CONCURRENCY)

    async def check(job: dict) -> dict:
        async with sem:
            res = await link_health.validate_job_url(job["url"], job["title"])
        return {**job, **res}

    results = await asyncio.gather(*[check(j) for j in jobs], return_exceptions=True)
    logged = {e.get("url") for e in await link_health.list_links()}

    broken = unknown = ok = failed = 0
    by_company: dict[str, list[int]] = {}  # name → [checked, broken]
    for r in results:
        if isinstance(r, BaseException):
            # A systemic failure (Redis down, DNS broken in the container)
            # must NOT look like a clean small run — count it, don't drop it.
            failed += 1
            continue
        st = r.get("status")
        tally = by_company.setdefault(r.get("company") or "?", [0, 0])
        tally[0] += 1
        if st == "broken":
            tally[1] += 1
        if st == "ok":
            ok += 1
            if r["url"] not in logged:
                continue  # don't bloat the log with healthy rows
        elif st == "broken":
            broken += 1
        else:
            unknown += 1
        await link_health.record(
            r["url"], company=r.get("company", ""), title=r.get("title", ""),
            source="cron", status=st, reason=r.get("reason", ""),
            http_code=r.get("http_code"), detail=r.get("detail", ""),
        )
    if failed:
        sample = next((r for r in results if isinstance(r, BaseException)), None)
        logger.warning("[cron] link scan: %d/%d check(s) raised an exception (sample: %s)",
                       failed, len(jobs), str(sample)[:200])
        await incidents_svc.report(
            "cron_error", module="cron.link_scan.check", severity="warning",
            error=sample if isinstance(sample, BaseException) else None,
            message=f"{failed}/{len(jobs)} link check(s) raised an exception",
            context={"failed": failed, "total": len(jobs)},
        )

    # Drift detector: when most of a company's SAMPLED detail URLs are dead,
    # that's not N coincidental closures — the site likely changed its URL
    # format (the GHN class: old links 200 into an empty SPA shell). Small
    # samples need unanimity; bigger ones a supermajority.
    from app.services import ops_alert
    for cname, (checked, broken_n) in sorted(by_company.items()):
        if _mostly_broken(checked, broken_n):
            await ops_alert.alert(
                "links_broken", cname,
                f"{broken_n}/{checked} URL job trong mẫu scan hỏng (shell rỗng/404/hết hạn) — "
                f"khả năng site đổi format URL chi tiết. Xem log link monitor.",
                context={"checked": checked, "broken": broken_n},
            )
    return {"scanned": len(jobs), "broken": broken, "unknown": unknown, "ok": ok, "failed": failed}


async def _run() -> None:
    render = os.getenv("CRON_RENDER") == "1"
    render_limit_env = os.getenv("CRON_RENDER_LIMIT")
    render_limit = int(render_limit_env) if render_limit_env else None

    ingest: dict = {}
    try:
        from app.services.job_ingest import ingest_featured_ats
        logger.info("[cron] ingest_featured_ats starting… (render=%s, render_limit=%s)",
                   render, render_limit)
        ingest = await ingest_featured_ats(render=render, render_limit=render_limit)
        logger.info("[cron] ingest done: %s", ingest)
    except Exception as e:
        logger.exception("[cron] ingest_featured_ats failed — continuing with remaining steps")
        await incidents_svc.report(
            "cron_error", module="cron.ingest_featured_ats", error=e,
            context={"render": render, "render_limit": render_limit},
        )

    try:
        # Drift detector (feed_died): a company whose feed USED to carry jobs
        # (compat baseline) and has now come back empty for ≥2 consecutive
        # cycles either migrated its site or — when the compat log says
        # antibot — is IP-blocking us (say that, not "site moved": the
        # TGDD/Chailease lesson). One cycle of quiet is just a transient.
        empties = ingest.get("ats_feed_empty") or []
        if empties:
            from app.services import ops_alert
            from app.services.job_ingest import _heal_eligibility
            elig = await _heal_eligibility()
            for e in empties:
                s = elig.get(e.get("name")) or {}
                if s.get("baseline", 0) < 3 or s.get("fail_streak", 0) < 2:
                    continue
                if s.get("antibot"):
                    detail = (f"Feed rỗng {s['fail_streak']} chu kỳ (baseline {s['baseline']} job), "
                              f"compat = needs_capture → nghi bị chặn IP từ Railway, "
                              f"chưa chắc site đổi URL. Thử /debug/fetch từ IP VN trước.")
                else:
                    cause = await _diagnose_feed_death(e.get("career_url") or "")
                    detail = (f"Feed rỗng {s['fail_streak']} chu kỳ liên tiếp "
                              f"(baseline {s['baseline']} job).\n"
                              f"Chẩn đoán: {cause}\n"
                              f"career_url: {e.get('career_url')}")
                await ops_alert.alert("feed_died", e.get("name") or "?", detail,
                                      context={**e, **s})
    except Exception as e:
        logger.exception("[cron] feed-died detector failed — continuing")
        await incidents_svc.report("cron_error", module="cron.feed_died_detector", error=e)

    try:
        # Drift detector (career_url_moved): career pages now redirecting to a
        # different host — catches full site migrations even while the old
        # adapter still limps along. Scoped to this run's empty-feed companies
        # (a vanity redirect over a live feed is cosmetic, not drift).
        empty = ({e.get("name") for e in ingest.get("ats_feed_empty", [])}
                 if ingest else None)
        logger.info("[cron] career_url drift probe starting… (scope=%s)",
                    "all" if empty is None else len(empty))
        drift = await _career_url_drift(empty)
        logger.info("[cron] career_url drift probe done: %s", drift)
    except Exception as e:
        logger.exception("[cron] career_url drift probe failed — continuing")
        await incidents_svc.report("cron_error", module="cron.career_url_drift", error=e)

    try:
        from app.services.embed_backfill import embed_backfill
        logger.info("[cron] embedding backfill starting…")
        embedded = await embed_backfill()
        logger.info("[cron] embedding backfill done: %d job(s) embedded", embedded)
    except Exception as e:
        logger.exception("[cron] embedding backfill failed — continuing with remaining steps")
        await incidents_svc.report("cron_error", module="cron.embed_backfill", error=e)

    try:
        from app.services.jd_backfill import jd_backfill
        logger.info("[cron] JD backfill starting…")
        jd_filled = await jd_backfill()
        logger.info("[cron] JD backfill done: %d job(s) got a stored JD", jd_filled)
    except Exception as e:
        logger.exception("[cron] JD backfill failed — continuing with remaining steps")
        await incidents_svc.report("cron_error", module="cron.jd_backfill", error=e)

    try:
        from app.services.seniority_backfill import seniority_backfill
        logger.info("[cron] seniority backfill starting…")
        filled = await seniority_backfill()
        logger.info("[cron] seniority backfill done: %d job(s) classified", filled)
    except Exception as e:
        logger.exception("[cron] seniority backfill failed — continuing with remaining steps")
        await incidents_svc.report("cron_error", module="cron.seniority_backfill", error=e)

    try:
        logger.info("[cron] link scan starting (limit=%s)…", _SCAN_LIMIT)
        scan = await _link_scan()
        logger.info("[cron] link scan done: %s", scan)
    except Exception as e:
        logger.exception("[cron] link scan failed — continuing with remaining steps")
        await incidents_svc.report("cron_error", module="cron.link_scan", error=e)

    try:
        # Prune promoted landing pages whose backing job just went inactive
        # (deactivate_missing ran during ingest above) — a closed posting
        # shouldn't keep a public "apply" page.
        from app.db import promoted
        dead = await promoted.delete_dead()
        logger.info("[cron] promoted cleanup: deleted %d dead page(s)%s",
                   len(dead), (" — " + ", ".join(dead[:20])) if dead else "")
    except Exception as e:
        logger.exception("[cron] promoted cleanup failed")
        await incidents_svc.report("cron_error", module="cron.promoted_cleanup", error=e)

    try:
        # Hard-delete jobs that have been dead (gone from feed / apply-gate dead)
        # past the grace window. Runs AFTER promoted cleanup so a job's landing
        # page is already gone by the time its row is purged. Live jobs are
        # never touched — last_seen_at is bumped every cycle they're in a feed.
        from app.db import jobs as jobs_repo
        purged = await jobs_repo.purge_dead(_DEAD_GRACE_HOURS)
        logger.info("[cron] purged %d job(s) dead > %dh", purged, _DEAD_GRACE_HOURS)
    except Exception as e:
        logger.exception("[cron] dead-job purge failed")
        await incidents_svc.report(
            "cron_error", module="cron.purge_dead", error=e,
            context={"grace_hours": _DEAD_GRACE_HOURS},
        )


async def main() -> None:
    from app.db.pool import close_pool
    from app.services.browser_pool import close_browser

    try:
        await asyncio.wait_for(_run(), timeout=_TOTAL_TIMEOUT)
    except asyncio.TimeoutError:
        logger.error("[cron] refresh exceeded %ds hard timeout — aborting this run", _TOTAL_TIMEOUT)
        await incidents_svc.report(
            "cron_error", module="cron.timeout",
            message=f"Refresh exceeded {_TOTAL_TIMEOUT}s hard timeout",
            context={"timeout_seconds": _TOTAL_TIMEOUT},
        )
    finally:
        await close_browser()
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
