#!/usr/bin/env python3
"""
CLI to test the Gemini grounded-search → company website resolver.

Examples:
    cd backend
    python -m scripts.find_company_website "OpenCommerce Group"
    python -m scripts.find_company_website "FPT Software" --no-cache
    python -m scripts.find_company_website "Shopee" --raw

Two flows are exposed:
    --search-only   call gemini_client.search_company_website directly
                    (just the LLM step, no cache, no validation)
    (default)       call career_finder.resolve_by_name — cache → grounded
                    search → host blacklist → HEAD probe → cache upsert
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Allow `python scripts/find_company_website.py …` from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.career_finder import resolve_by_name
from app.services.gemini_client import search_company_website


def _dump(label: str, payload) -> None:
    print(f"\n── {label} " + "─" * max(0, 78 - len(label)))
    if hasattr(payload, "__dict__"):
        payload = payload.__dict__
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("name", help='Company name, e.g. "OpenCommerce Group"')
    ap.add_argument(
        "--search-only", action="store_true",
        help="Skip cache + validation; just run the grounded search step",
    )
    ap.add_argument(
        "--no-cache", action="store_true",
        help="Skip the cache read (still writes on success)",
    )
    ap.add_argument(
        "--raw", action="store_true",
        help="Also print the raw model response (for debugging the prompt)",
    )
    args = ap.parse_args()

    if args.search_only:
        result = await asyncio.to_thread(search_company_website, args.name)
        if not args.raw:
            result.pop("raw", None)
        _dump("GROUNDED SEARCH", result)
        return 0

    resolution = await resolve_by_name(args.name, use_cache=not args.no_cache)
    _dump("RESOLUTION", resolution)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
