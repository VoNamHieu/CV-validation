"""Repair companies split/duplicated by ATS-host domain.

Historically ``job_ingest`` keyed a company on the host of its ``career_url``.
For any company whose careers page lives on a third-party ATS (mokahr,
myworkdayjobs, greenhouse, smartrecruiters, …) or a careers subdomain, that
produced the WRONG domain — either a second row split from the company's real
identity row, or (on shared hosts like ``boards.greenhouse.io``) two different
companies collapsed onto one row.

The ingest fix keys on the homepage domain instead (see job_ingest). This
script realigns the EXISTING rows so ingest converges onto them instead of
minting fresh duplicates:

  For every company row whose name matches a FEATURED_COMPANIES entry and whose
  domain != that entry's homepage domain (the canonical identity domain):
    • if a row with the canonical domain already exists → MERGE: repoint this
      row's jobs onto it (dropping any external_id collisions), fill blank
      metadata, then delete this row;
    • else → rename this row's domain to the canonical domain in place.

Idempotent: a second run finds nothing to fix. Dry-run by default — pass
``--apply`` to write.

    python -m scripts.dedupe_companies            # dry run (default)
    python -m scripts.dedupe_companies --apply     # execute
"""
from __future__ import annotations

import argparse
import asyncio
import os
from urllib.parse import urlparse

import asyncpg
from dotenv import load_dotenv


def _domain(url: str | None) -> str | None:
    try:
        host = (urlparse(url or "").netloc or "").lower()
        return host[4:] if host.startswith("www.") else (host or None)
    except Exception:
        return None


def _canonical_domains() -> dict[str, str]:
    """{lower(name): homepage_domain} from the featured catalog."""
    from app.data.featured_companies import FEATURED_COMPANIES
    out: dict[str, str] = {}
    for c in FEATURED_COMPANIES:
        d = _domain(c.homepage)
        if d:
            out[c.name.strip().lower()] = d
    return out


async def _merge_row_into(conn, src_id: str, dst_id: str) -> tuple[int, int]:
    """Repoint src's jobs onto dst, then delete src. Returns (moved, dropped)."""
    # external_id is unique per (company_id, external_id); drop src jobs that
    # would collide with an existing dst job, then repoint the rest.
    dropped_rows = await conn.fetch(
        """
        WITH collide AS (
            SELECT s.id FROM jobs s
            JOIN jobs d ON d.company_id = $2 AND d.external_id = s.external_id
            WHERE s.company_id = $1
        )
        DELETE FROM jobs WHERE id IN (SELECT id FROM collide) RETURNING id
        """,
        src_id, dst_id,
    )
    dropped_n = len(dropped_rows)
    moved_rows = await conn.fetch(
        "UPDATE jobs SET company_id = $2 WHERE company_id = $1 RETURNING id",
        src_id, dst_id,
    )
    # Fill blank metadata on dst from src (never overwrite existing dst values).
    await conn.execute(
        """
        UPDATE companies dst SET
            career_url = COALESCE(NULLIF(dst.career_url, ''), src.career_url),
            industry   = COALESCE(dst.industry, src.industry),
            ats_type   = COALESCE(dst.ats_type, src.ats_type),
            segment    = COALESCE(dst.segment, src.segment),
            in_universe  = dst.in_universe OR src.in_universe,
            demand_score = GREATEST(dst.demand_score, src.demand_score)
        FROM companies src
        WHERE dst.id = $2 AND src.id = $1
        """,
        src_id, dst_id,
    )
    await conn.execute("DELETE FROM companies WHERE id = $1", src_id)
    return len(moved_rows), dropped_n


async def main(apply: bool) -> None:
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    load_dotenv()  # also honor a backend-local .env if present
    canon = _canonical_domains()
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    mode = "APPLY" if apply else "DRY-RUN"
    print(f"[{mode}] dedupe companies — {len(canon)} featured names known\n")
    renamed = merged = moved_jobs = dropped_jobs = skipped = 0
    try:
        rows = await conn.fetch(
            "SELECT id::text, name, domain, career_url FROM companies ORDER BY name"
        )
        for r in rows:
            name_key = (r["name"] or "").strip().lower()
            target = canon.get(name_key)
            if not target:
                continue  # not a featured company — leave untouched
            if (r["domain"] or "").lower() == target:
                continue  # already canonical
            n_jobs = await conn.fetchval(
                "SELECT count(*) FROM jobs WHERE company_id = $1", r["id"]
            )
            existing = await conn.fetchrow(
                "SELECT id::text FROM companies WHERE lower(domain) = $1 AND id <> $2",
                target, r["id"],
            )
            if existing:
                print(f"  MERGE  {r['name']:20} {r['domain']} → {target} "
                      f"(move {n_jobs} jobs into existing row)")
                if apply:
                    async with conn.transaction():
                        mv, dr = await _merge_row_into(conn, r["id"], existing["id"])
                    moved_jobs += mv
                    dropped_jobs += dr
                merged += 1
            else:
                print(f"  RENAME {r['name']:20} {r['domain']} → {target} "
                      f"({n_jobs} jobs stay)")
                if apply:
                    await conn.execute(
                        "UPDATE companies SET domain = $1 WHERE id = $2", target, r["id"]
                    )
                renamed += 1

        print(f"\n{mode} summary: {renamed} renamed, {merged} merged "
              f"({moved_jobs} jobs moved, {dropped_jobs} collisions dropped), {skipped} skipped")
        if not apply:
            print("Re-run with --apply to write.")
    finally:
        await conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = ap.parse_args()
    asyncio.run(main(args.apply))
