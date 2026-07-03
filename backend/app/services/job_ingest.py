"""Slice-1 ingest: enrich the job store from featured companies' ATS feeds.

For every featured company that exposes an ATS feed (~1/3 of the set, but most
of the job VOLUME — see the ATS-coverage measurement), pull its open postings in
ONE call via ``fetch_ats_jobs`` and upsert them into ``public.jobs`` WITH the
structured fields the facet ranking needs (role_family, seniority,
required_years_min, description). Search then ranks over this rich store
(``CATALOG_SOURCE=db``/``both``) instead of the shallow featured crawl cache, so
years-fit + seniority actually engage.

Deliberately low-ops: no scheduler here — run on demand (POST /store/ingest-
featured or call this fn). The diff-sweep worker + embeddings are slice 2.
"""
from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def _domain(url: str) -> str | None:
    try:
        host = (urlparse(url).netloc or "").lower()
        return host[4:] if host.startswith("www.") else (host or None)
    except Exception:
        return None


async def _render(url: str) -> str:
    """Rendered HTML (post-JS) so embed-based ATS (Workday/SuccessFactors/…) are
    detectable. Best-effort; returns '' on failure."""
    try:
        from app.services.crawler import try_playwright_fetch
        ok, html = await asyncio.wait_for(try_playwright_fetch(url), timeout=45)
        return html if ok else ""
    except Exception:
        return ""


async def _spa_sniff(url: str) -> list[dict]:
    """Last-resort acquisition: render the page and watch its XHR for the job
    feed. Many career SPAs (Grab, Siemens, EY, DHL, Renesas, KiotViet, Sea…)
    render jobs the static ATS parser can't see; this is the same path
    career_compat.probe uses. Best-effort → [] on failure.

    VN guard: if some results are VN-tagged, keep only those; if all are tagged
    but none VN, it's a global page with no VN roles → drop (don't flood the
    store with foreign jobs); if none are location-tagged (VN-domestic sites
    often aren't), keep them all."""
    try:
        from app.services.spa_sniff import sniff_jobs
        from app.services.ats_adapters.core import _is_vn_loc, _finalize
        jobs = await asyncio.wait_for(sniff_jobs(url), timeout=50)
    except Exception as e:  # noqa: BLE001
        logger.info("ingest: spa_sniff failed for %s: %s", url, str(e)[:80])
        return []
    # _finalize drops nav/section labels + date rows, dedups, caps — spa_sniff
    # is heuristic and picks up some category/location labels as "jobs".
    jobs = _finalize([j for j in (jobs or []) if j.get("title") and j.get("url")])
    vn = [j for j in jobs if _is_vn_loc(j.get("location") or "")]
    located = [j for j in jobs if (j.get("location") or "").strip()]
    if vn:
        jobs = vn
    elif located:
        jobs = []            # all located, none VN → global page, skip
    for j in jobs:
        j.setdefault("source", "spa_sniff")
    return jobs


async def ingest_featured_ats(*, render: bool = False, limit: int | None = None) -> dict:
    """Ingest ATS-backed featured companies into the store. `render=True` also
    renders bespoke pages to catch embedded ATS (slower, needs the browser)."""
    from app.data.featured_companies import FEATURED_COMPANIES
    from app.services.ats_adapters.core import fetch_ats_jobs
    from app.search.taxonomy import classify_title, classify_seniority
    from app.search.company_industry import classify_company
    from app.search.facet import _required_years
    from app.db import companies as companies_repo, jobs as jobs_repo

    comps = list(FEATURED_COMPANIES)[: limit or None]
    stats: dict = {"companies_with_feed": 0, "jobs_upserted": 0,
                   "jobs_deactivated": 0, "by_source": {}}
    sem = asyncio.Semaphore(8)  # bound concurrent ATS fetches / renders

    async def one(c) -> tuple[str, int] | None:
        async with sem:
            jobs_list = await asyncio.to_thread(fetch_ats_jobs, c.career_url, None)
            if not jobs_list and render:
                html = await _render(c.career_url)
                if html:
                    jobs_list = await asyncio.to_thread(fetch_ats_jobs, c.career_url, html)
                if not jobs_list:
                    # SPA whose jobs load via XHR — the static ATS parser can't
                    # read them; watch the network instead.
                    jobs_list = await _spa_sniff(c.career_url)
        if not jobs_list:
            return None

        industry = classify_company(c.name, c.career_url)
        try:
            # Dedupe key = the company's OWN identity domain (homepage), NOT the
            # career_url host. Many career pages live on a third-party ATS
            # (mokahr / myworkdayjobs / greenhouse / smartrecruiters …) or a
            # careers subdomain, so keying on career_url both splits a company
            # from its real-domain row and — on SHARED ATS hosts like
            # boards.greenhouse.io — collides two different companies onto one
            # row. homepage is stable and unique per company. Fall back to the
            # career_url host only when a company has no homepage.
            company = await companies_repo.upsert(
                name=c.name,
                domain=_domain(c.homepage) or _domain(c.career_url),
                career_url=c.career_url,
                industry=industry, in_universe=True,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("ingest: company upsert failed for %s: %s", c.name, e)
            return None
        cid = company.get("id")

        n = 0
        live_ids: list[str] = []
        for j in jobs_list:
            title = (j.get("title") or "").strip()
            url = j.get("url") or ""
            if not title or not url:
                continue
            fam, _conf = classify_title(title)
            try:
                await jobs_repo.upsert(
                    company_id=cid,
                    external_id=url,                       # stable per posting → refresh on re-ingest
                    title=title,
                    location=j.get("location") or None,
                    description=j.get("description") or None,
                    role_family=fam,
                    industry=industry,
                    seniority=classify_seniority(title),
                    required_years_min=_required_years(j),  # regex on title+description
                    source_url=url,
                )
                n += 1
                live_ids.append(url)
            except Exception as e:  # noqa: BLE001
                logger.info("ingest: job upsert failed (%s): %s", url, str(e)[:80])
        if not n:
            return None
        # v1 liveness diff: postings this company had but that are NO LONGER in
        # the feed are dead → deactivate so search stops showing them. Safe: only
        # runs when the feed returned jobs (empty feed skipped above).
        dead = await jobs_repo.deactivate_missing(cid, live_ids)
        return (jobs_list[0].get("source", "?"), n, dead)

    results = await asyncio.gather(*[one(c) for c in comps])
    for r in results:
        if not r:
            continue
        src, n, dead = r
        stats["companies_with_feed"] += 1
        stats["jobs_upserted"] += n
        stats["jobs_deactivated"] += dead
        stats["by_source"][src] = stats["by_source"].get(src, 0) + 1

    logger.info("[ingest] featured ATS → %s", stats)
    return stats
