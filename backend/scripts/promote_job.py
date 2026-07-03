"""Publish existing jobs as public landing pages — DEMO SEED helper.

Bypasses the admin-auth API and writes straight to promoted_jobs, so you can
generate a few public pages from jobs already in the DB and eyeball them before
the admin UI exists.

Run from backend/:
  python -m scripts.promote_job --latest 3      # promote 3 newest active jobs
  python -m scripts.promote_job <job_id> ...    # promote specific job ids
  python -m scripts.promote_job --list          # show already-published pages

Idempotent per job: re-running refreshes the snapshot instead of duplicating.
Needs DATABASE_URL. Prints the public path (/j/<slug>) for each page.
"""
from __future__ import annotations

import argparse
import asyncio

from dotenv import load_dotenv

load_dotenv()

from app.db import companies as companies_repo  # noqa: E402
from app.db import jobs as jobs_repo  # noqa: E402
from app.db import promoted  # noqa: E402
from app.db.pool import close_pool, get_pool  # noqa: E402


async def _promote(job_id: str) -> str | None:
    job = await jobs_repo.get(job_id)
    if not job:
        print(f"  ✖ {job_id} — not found")
        return None
    company_name = ""
    if job.get("company_id"):
        company = await companies_repo.get(job["company_id"])
        company_name = (company or {}).get("name") or ""

    from app.services.jd_resolver import resolve_full_jd
    full_jd = await resolve_full_jd(job.get("source_url") or "", job.get("description") or "")
    if full_jd and len(full_jd) > len(job.get("description") or ""):
        job = {**job, "description": full_jd}
    snapshot = promoted.build_snapshot(job, company_name=company_name)

    existing = await promoted.get_by_job(job_id)
    if existing:
        row = await promoted.update(existing["id"], snapshot=snapshot, status="published")
        print(f"  ↻ refreshed  /j/{row['slug']}  ({snapshot['title']})")
        return row["slug"]

    slug = await promoted.unique_slug(f"{snapshot['title']}-{company_name}")
    row = await promoted.create(slug=slug, job_id=job_id, snapshot=snapshot,
                                status="published")
    print(f"  ✓ published  /j/{row['slug']}  ({snapshot['title']})")
    return slug


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("job_ids", nargs="*", help="job ids to promote")
    ap.add_argument("--latest", type=int, help="promote the N newest active jobs")
    ap.add_argument("--list", action="store_true", help="list published pages")
    args = ap.parse_args()

    try:
        if args.list:
            for p in await promoted.list_pages(limit=200):
                snap = p.get("snapshot") or {}
                print(f"  /j/{p['slug']}  [{p['status']}]  views={p['view_count']}  "
                      f"{snap.get('title', '')}")
            return

        job_ids = list(args.job_ids)
        if args.latest:
            pool = await get_pool()
            rows = await pool.fetch(
                "SELECT id FROM jobs WHERE is_active = true "
                "ORDER BY created_at DESC LIMIT $1", args.latest,
            )
            job_ids += [str(r["id"]) for r in rows]

        if not job_ids:
            print("Nothing to do. Pass job ids, --latest N, or --list.")
            return

        print(f"Promoting {len(job_ids)} job(s):")
        for jid in job_ids:
            await _promote(jid)
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
