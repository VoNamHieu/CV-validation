#!/usr/bin/env python3
"""
Sanity-check Stage 4 against every entry in FEATURED_COMPANIES.

For each company, runs `extract_jobs_from_career_page` and prints:
    - status  ✓ ok / ⚠ empty / ✗ error
    - latency (ms)
    - first 3 job titles + URLs (truncated)

Use this before any investor demo to confirm none of the curated career
pages have changed shape or started returning zero jobs.

Usage:
    cd backend
    python -m scripts.test_featured                # all companies, parallel
    python -m scripts.test_featured --serial       # one at a time (easier logs)
    python -m scripts.test_featured --only momo    # filter by name substring
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.data.featured_companies import FEATURED_COMPANIES
from app.services.career_finder import extract_jobs_from_career_page


async def _check_one(company) -> dict:
    start = time.time()
    try:
        jobs = await extract_jobs_from_career_page(company.career_url)
        return {
            "name": company.name,
            "career_url": company.career_url,
            "status": "ok" if jobs else "empty",
            "count": len(jobs),
            "latency_ms": int((time.time() - start) * 1000),
            "samples": [(j.title[:60], j.url[:80]) for j in jobs[:3]],
            "error": "",
        }
    except Exception as e:
        return {
            "name": company.name,
            "career_url": company.career_url,
            "status": "error",
            "count": 0,
            "latency_ms": int((time.time() - start) * 1000),
            "samples": [],
            "error": str(e)[:200],
        }


def _print_row(r: dict) -> None:
    icon = {"ok": "✓", "empty": "⚠", "error": "✗"}[r["status"]]
    print(f"\n{icon} {r['name']:24s}  [{r['count']:3d} jobs · {r['latency_ms']:5d}ms]")
    print(f"  → {r['career_url']}")
    if r["error"]:
        print(f"  ! {r['error']}")
    for title, url in r["samples"]:
        print(f"    · {title}  ({url})")


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--serial", action="store_true", help="Process one at a time")
    ap.add_argument("--only", help="Substring match on company name")
    args = ap.parse_args()

    companies = list(FEATURED_COMPANIES)
    if args.only:
        needle = args.only.lower()
        companies = [c for c in companies if needle in c.name.lower()]
    if not companies:
        print("No companies matched.", file=sys.stderr)
        return 2

    print(f"Checking {len(companies)} featured career pages "
          f"({'serial' if args.serial else 'parallel'})...")

    if args.serial:
        results = []
        for c in companies:
            r = await _check_one(c)
            _print_row(r)
            results.append(r)
    else:
        results = await asyncio.gather(*[_check_one(c) for c in companies])
        for r in results:
            _print_row(r)

    ok = sum(1 for r in results if r["status"] == "ok")
    empty = sum(1 for r in results if r["status"] == "empty")
    err = sum(1 for r in results if r["status"] == "error")
    total_jobs = sum(r["count"] for r in results)
    print(f"\n── Summary: {ok} ok · {empty} empty · {err} error · "
          f"{total_jobs} total jobs ──")
    # Non-zero exit if anything failed — useful for CI.
    return 0 if err == 0 and empty == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
