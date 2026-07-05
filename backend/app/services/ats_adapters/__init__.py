"""ATS adapters package.

Public surface (unchanged for callers): fetch_ats_jobs, detect_ats,
detect_ats_in_html. `core` is the dispatch entrypoint; `_shared` holds shared
helpers, `generic` the hosted-ATS fetchers, `vendors` the per-company adapters
+ the `_ADAPTERS` registry; `schema` defines the normalized Job model.

To add an ATS: write `_is_x` / `_x` in vendors.py and append one line to
vendors._ADAPTERS — no other edits.
"""
from .schema import Job
from .core import (
    fetch_ats_jobs,
    detect_ats,
    detect_ats_in_html,
    is_known_ats_url,
    _is_basevn,      # used by audit/diagnostic scripts
    _FETCHERS,
    _ADAPTERS,
)

__all__ = [
    "Job",
    "fetch_ats_jobs",
    "detect_ats",
    "detect_ats_in_html",
    "is_known_ats_url",
]
