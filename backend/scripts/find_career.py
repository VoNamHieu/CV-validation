#!/usr/bin/env python3
"""
CLI runner for the career-finder pipeline. Useful for ad-hoc testing without
spinning up FastAPI.

Usage:
    python -m scripts.find_career --topcv https://www.topcv.vn/cong-ty/.../123.html
    python -m scripts.find_career --homepage https://acme.com
    python -m scripts.find_career --homepage https://acme.com --stage nav
    python -m scripts.find_career --homepage https://acme.com --stage brute
    python -m scripts.find_career --homepage https://acme.com --stage sitemap
    python -m scripts.find_career --career-url https://acme.com/careers --stage jobs

Run from backend/:
    cd backend && python -m scripts.find_career --topcv ...
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Allow running as `python scripts/find_career.py` from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.career_finder import (
    find_careers,
    resolve_from_topcv_or_vnw,
    resolve_by_name,
    find_career_via_nav,
    brute_force_career_paths,
    find_via_sitemap,
    extract_jobs_from_career_page,
)
from app.services import company_cache


def _print(label: str, payload) -> None:
    print(f"\n── {label} " + "─" * (78 - len(label)))
    if hasattr(payload, "to_dict"):
        payload = payload.to_dict()
    elif hasattr(payload, "__dict__"):
        payload = payload.__dict__
    elif isinstance(payload, list):
        payload = [getattr(p, "__dict__", p) for p in payload]
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    src = ap.add_mutually_exclusive_group(required=False)
    src.add_argument("--topcv", help="TopCV/VNW URL (company profile or job posting)")
    src.add_argument("--homepage", help="Company's own website URL")
    src.add_argument("--career-url", help="A known career page URL (for --stage jobs)")
    src.add_argument("--name", help="Company name (cache lookup only)")
    ap.add_argument(
        "--stage",
        choices=("all", "resolve", "nav", "brute", "sitemap", "jobs"),
        default="all",
        help="Which pipeline stage to run (default: all)",
    )
    ap.add_argument("--no-cache", action="store_true", help="Bypass the cache on resolve")
    ap.add_argument("--show-cache", action="store_true", help="Print cache contents and exit")
    ap.add_argument("--clear-cache", action="store_true", help="Wipe the cache and exit")
    args = ap.parse_args()

    # ── Cache admin shortcuts ──
    if args.show_cache:
        _print("CACHE STATS", company_cache.stats())
        _print("CACHE ROWS", company_cache.list_all(limit=100))
        return 0
    if args.clear_cache:
        n = company_cache.clear_all()
        print(f"Cleared {n} rows from cache.")
        return 0

    if not (args.topcv or args.homepage or args.career_url or args.name):
        ap.error("provide one of --topcv / --homepage / --career-url / --name (or use --show-cache)")

    if args.stage == "all":
        if args.career_url:
            print("--stage all needs --topcv / --homepage / --name, not --career-url", file=sys.stderr)
            return 2
        result = await find_careers(
            input_url=args.topcv,
            homepage_url=args.homepage,
            company_name=args.name,
        )
        _print("FULL PIPELINE", result)
        return 0

    if args.stage == "resolve":
        if args.name and not args.topcv:
            _print("STAGE 0: RESOLVE BY NAME (cache)", await resolve_by_name(args.name))
            return 0
        if not args.topcv:
            print("--stage resolve needs --topcv or --name", file=sys.stderr)
            return 2
        _print(
            "STAGE 0: RESOLVE",
            await resolve_from_topcv_or_vnw(args.topcv, use_cache=not args.no_cache),
        )
        return 0

    target = args.homepage or args.career_url
    if not target:
        print("This stage needs --homepage or --career-url", file=sys.stderr)
        return 2

    if args.stage == "nav":
        _print("STAGE 1: NAV", await find_career_via_nav(target))
    elif args.stage == "brute":
        _print("STAGE 2: BRUTE-FORCE", await brute_force_career_paths(target))
    elif args.stage == "sitemap":
        _print("STAGE 3: SITEMAP", await find_via_sitemap(target))
    elif args.stage == "jobs":
        _print("STAGE 4: JOBS", await extract_jobs_from_career_page(target))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
