"""Offline ranking-quality eval for the facet + rerank search engine.

Answers the one question that gates all weight-tuning (critique điểm 5):
does Phase-2 cosine rerank actually improve top-K ordering over facet-only?
Measured as NDCG@10 against a hand-labeled golden set.

Runs the SAME code paths as /career/search — rank_jobs (Phase 1) and
rerank_bucket (Phase 2) — against a frozen job snapshot, so the A/B is
apples-to-apples and stays reproducible as the live DB churns.

Pipeline (run from backend/ with the app env loaded — DB DSN + GEMINI key):

  1. python -m eval.eval_ranking dump      # freeze the job pool → eval/pool.jsonl
  2. python -m eval.eval_ranking sheet      # profiles.json → eval/to_label.csv
     ...  hand-label the `grade` column (0..3)  in to_label.csv  ...
  3. python -m eval.eval_ranking score      # NDCG@10 facet-only vs +rerank
"""
import argparse
import asyncio
import csv
import json
import math
from pathlib import Path

try:                                    # load backend/.env the same way the app does
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

HERE = Path(__file__).parent
POOL = HERE / "pool.jsonl"
PROFILES = HERE / "profiles.json"
SHEET = HERE / "to_label.csv"
EMB_CACHE = HERE / "emb_cache.json"


def _patch_cache() -> None:
    """Swap the app's Redis cache for a local dict backed by EMB_CACHE.

    rerank_bucket fires ~60 parallel get_json per profile (semantic._get_many);
    against a connection-capped Upstash that hangs the whole eval. Vectors are
    content-hash keyed, so a flat file is a perfectly good cache here — and it
    makes repeat runs free and offline."""
    from app.services import cache
    store: dict = json.loads(EMB_CACHE.read_text()) if EMB_CACHE.exists() else {}

    async def get_json(key):
        return store.get(key)

    async def set_json(key, value, ttl_seconds):
        store[key] = value

    cache.get_json, cache.set_json = get_json, set_json
    import atexit
    atexit.register(lambda: EMB_CACHE.write_text(json.dumps(store)))

TOPK = 10           # NDCG cut-off + how deep we pool candidates for labeling
POOL_LIMIT = 2000   # snapshot size (prod /search caps the DB pool at 1000)


def _profiles() -> list[dict]:
    return json.loads(PROFILES.read_text())


def _load_pool() -> list[dict]:
    # pool.jsonl is a raw DB dump; mirror the prod DB-path garbage gate
    # (career._db_pool) so the eval ranks exactly what production would.
    from app.routers.career import _is_garbage_title
    jobs = [json.loads(ln) for ln in POOL.read_text().splitlines() if ln.strip()]
    return [j for j in jobs if not _is_garbage_title(j.get("title", ""))]


def _build_profile(p: dict):
    """Mirror career.py:/search — explicit fields, no LLM distill (deterministic)."""
    from app.search.profile import build_profile, families_from_roles
    prof = build_profile(p.get("target_roles", []), p.get("domains"), p.get("level", ""))
    if p.get("cv_roles"):                       # CV-as-constraint → fit_mult
        prof.cv_families = families_from_roles(p["cv_roles"])
    if p.get("years_of_experience"):            # feeds years-fit demote
        prof.candidate_years = int(p["years_of_experience"])
    return prof


def _query_text(p: dict) -> str:
    # Same fallback the endpoint uses when there's no cv_text (career.py:536).
    return (p.get("query_text") or
            " ".join(p.get("target_roles", []) + p.get("domains", []))).strip()


def _job_id(j: dict) -> str:
    return str(j.get("id") or j.get("url") or j.get("title"))


async def _rank(pool: list[dict], p: dict, *, rerank: bool) -> list[dict]:
    from app.search.facet import rank_jobs
    from app.search.semantic import rerank_bucket
    prof = _build_profile(p)
    ranked = rank_jobs(pool, prof)              # Phase 1 — pure, deterministic
    if rerank and ranked:
        qt = _query_text(p)
        if qt:
            ranked = await rerank_bucket(ranked, qt, top=60)
    return ranked


# ── commands ─────────────────────────────────────────────────────────────────
async def cmd_dump(_):
    from app.db import jobs as jobs_repo
    pool = await jobs_repo.list_for_facet(limit=POOL_LIMIT)
    with POOL.open("w") as f:
        for j in pool:
            f.write(json.dumps(j, default=str, ensure_ascii=False) + "\n")
    print(f"froze {len(pool)} jobs → {POOL}")


async def cmd_sheet(_):
    _patch_cache()
    pool = _load_pool()
    rows: list[dict] = []
    for p in _profiles():
        # Pool candidates from BOTH variants' top-K (TREC-style pooling): label
        # only the union, not the whole snapshot.
        facet = await _rank(pool, p, rerank=False)
        rr = await _rank(pool, p, rerank=True)
        seen: dict[tuple, dict] = {}
        for ranked in (facet, rr):
            for j in ranked[:TOPK]:
                key = (p["id"], _job_id(j))
                if key not in seen:
                    seen[key] = {
                        "profile_id": p["id"],
                        "job_id": _job_id(j),
                        "title": (j.get("title") or "")[:80],
                        "company": j.get("company") or j.get("company_name") or "",
                        "facet_score": j.get("_facet", {}).get("score"),
                        "cos": j.get("_cos", ""),
                        "grade": "",           # ← fill 0..3 by hand
                    }
        rows.extend(seen.values())
    with SHEET.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["profile_id", "job_id", "title",
                                          "company", "facet_score", "cos", "grade"])
        w.writeheader()
        w.writerows(rows)
    nonzero_cos = sum(1 for r in rows if str(r["cos"]) not in ("", "0", "0.0", "-"))
    print(f"{len(rows)} rows → {SHEET}  (fill `grade` 0..3)")
    print(f"sanity: {nonzero_cos}/{len(rows)} rows have a non-zero cosine "
          f"→ if this is ~0, rerank is silently degrading (check GEMINI key / Redis)")


def _dcg(grades: list[float]) -> float:
    return sum(g / math.log2(i + 2) for i, g in enumerate(grades))


async def cmd_score(_):
    labels: dict[tuple, float] = {}
    with SHEET.open() as f:
        for r in csv.DictReader(f):
            g = (r.get("grade") or "").strip()
            if g != "":
                labels[(r["profile_id"], r["job_id"])] = float(g)
    if not labels:
        print("no grades found in to_label.csv — fill the `grade` column first")
        return

    _patch_cache()
    pool = _load_pool()
    print(f"{'profile':28} {'facet':>7} {'+rerank':>8} {'Δ':>7}", flush=True)
    fs, rs, unlabeled = [], [], 0
    for p in _profiles():
        facet = await _rank(pool, p, rerank=False)
        rr = await _rank(pool, p, rerank=True)
        gf = [labels.get((p["id"], _job_id(j)), 0.0) for j in facet[:TOPK]]
        gr = [labels.get((p["id"], _job_id(j)), 0.0) for j in rr[:TOPK]]
        # Coverage guard: a top-K item with no label counts as 0 — if rankings
        # drifted since `sheet` (e.g. re-embedded vectors), that's bias from a
        # coverage hole, not a relevance judgment. Report it, don't hide it.
        unlabeled += sum(1 for j in facet[:TOPK] + rr[:TOPK]
                         if (p["id"], _job_id(j)) not in labels)
        # SHARED per-profile IDCG (condensed-list NDCG): the ideal top-K over
        # ALL labeled jobs for this profile — same denominator for both
        # variants, so retrieving better jobs scores higher, not just neatly
        # ordering whatever happened to be fetched (per-list IDCG rewards
        # uniformly-mediocre retrieval with a perfect 1.0).
        pool_grades = sorted((g for (pid, _), g in labels.items()
                              if pid == p["id"]), reverse=True)
        idcg = _dcg(pool_grades[:TOPK])
        nf = _dcg(gf) / idcg if idcg > 0 else 0.0
        nr = _dcg(gr) / idcg if idcg > 0 else 0.0
        fs.append(nf)
        rs.append(nr)
        print(f"{p['id']:28} {nf:7.3f} {nr:8.3f} {nr - nf:+7.3f}", flush=True)
    mf, mr = sum(fs) / len(fs), sum(rs) / len(rs)
    helped = sum(1 for a, b in zip(fs, rs) if b > a + 1e-9)
    hurt = sum(1 for a, b in zip(fs, rs) if b < a - 1e-9)
    print("-" * 52)
    print(f"{'MEAN NDCG@10':28} {mf:7.3f} {mr:8.3f} {mr - mf:+7.3f}")
    print(f"\nrerank helped {helped}/{len(fs)} profiles, hurt {hurt}, tied "
          f"{len(fs) - helped - hurt}")
    print(f"label coverage: {unlabeled} unlabeled top-{TOPK} slots "
          f"(0 = clean; >0 = rankings drifted since `sheet`, rerun sheet + label the new rows)")


CMDS = {"dump": cmd_dump, "sheet": cmd_sheet, "score": cmd_score}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cmd", choices=list(CMDS))
    args = ap.parse_args()
    asyncio.run(CMDS[args.cmd](args))


if __name__ == "__main__":
    main()
