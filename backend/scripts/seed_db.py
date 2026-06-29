"""Ingest intern_jobs.json → Postgres (companies + jobs), index-time embedded.

For each posting:
  - upsert its company (deduped by name, keyed on the URL-host domain),
  - classify role_family / seniority via the taxonomy, industry via company map,
  - embed the JD doc (gemini-embedding-001, RETRIEVAL_DOCUMENT) → jobs.embedding.

Run from backend/:  python -m scripts.seed_db   (needs DATABASE_URL + GEMINI_API_KEY)
Idempotent: companies upsert by domain, jobs upsert by (company_id, external_id=url).
"""
from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

from app.db import companies as companies_repo
from app.db import jobs as jobs_repo
from app.db.pool import close_pool, get_pool
from app.search.company_industry import classify_company
from app.search.embed import build_job_doc, embed_jobs
from app.search.taxonomy import classify_seniority, classify_title

REPO_ROOT = Path(__file__).resolve().parents[2]
INTERN_JOBS = REPO_ROOT / "intern_jobs.json"


def _domain(url: str) -> str | None:
    try:
        host = urlparse(url).netloc.lower().split(":")[0]
        return (host[4:] if host.startswith("www.") else host) or None
    except Exception:
        return None


def _norm_name(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


async def _ensure_companies(records: list[dict]) -> dict[str, str]:
    """Upsert one company per distinct employer. Returns {norm_name: company_id}."""
    name_to_id: dict[str, str] = {}
    for r in records:
        key = _norm_name(r["company"])
        if key in name_to_id:
            continue
        row = await companies_repo.upsert(
            name=r["company"],
            domain=_domain(r["url"]) or f"{_slug(r['company'])}.seed",
            industry=classify_company(r["company"], r["url"]),
            in_universe=True,
        )
        name_to_id[key] = row["id"]
    print(f"  companies: {len(name_to_id)} upserted")
    return name_to_id


async def main():
    records = json.loads(INTERN_JOBS.read_text())
    print(f"ingesting {len(records)} postings from {INTERN_JOBS.name}")

    name_to_id = await _ensure_companies(records)

    # Classify each posting via the taxonomy (NOT the raw JSON fields).
    classified = []
    for r in records:
        role_family, _conf = classify_title(r["title"])
        seniority = classify_seniority(r["title"]) or "Intern/Fresher"
        classified.append((r, role_family, seniority))

    # Index-time embedding: one doc per posting, batched inside embed_jobs.
    docs = [build_job_doc(r["title"], must_have=None) for r, _, _ in classified]
    print(f"  embedding {len(docs)} JD docs via Gemini …")
    vectors = embed_jobs(docs)

    n = 0
    for (r, role_family, seniority), vec in zip(classified, vectors):
        await jobs_repo.upsert(
            company_id=name_to_id[_norm_name(r["company"])],
            external_id=r["url"],          # stable per posting → idempotent
            title=r["title"],
            location=r.get("location"),
            role_family=role_family,
            industry=classify_company(r["company"], r["url"]),
            seniority=seniority,
            source_url=r["url"],
            embedding=vec,
        )
        n += 1
    print(f"  jobs: {n} upserted (classified + embedded)")

    pool = await get_pool()
    total = await pool.fetchval("SELECT count(*) FROM jobs")
    embedded = await pool.fetchval("SELECT count(*) FROM jobs WHERE embedding IS NOT NULL")
    by_fam = await pool.fetch(
        "SELECT role_family, count(*) c FROM jobs GROUP BY role_family ORDER BY c DESC LIMIT 6"
    )
    print(f"\nVERIFY: count(*) jobs = {total}; embedding IS NOT NULL = {embedded}")
    print("  top role_families:", {r["role_family"]: r["c"] for r in by_fam})
    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
