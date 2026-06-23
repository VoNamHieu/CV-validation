"""ATS adapters package.

Public surface (unchanged for callers): fetch_ats_jobs, detect_ats,
detect_ats_in_html. `core` holds the adapter implementations + the _ADAPTERS
registry; `schema` defines the normalized Job model used by the search layer.

To add an ATS: write `_is_x` / `_x` in core.py and append one line to
core._ADAPTERS — no other edits.
"""
from .schema import Job
from .core import (
    fetch_ats_jobs,
    detect_ats,
    detect_ats_in_html,
    _is_basevn,      # used by audit/diagnostic scripts
    _FETCHERS,
    _ADAPTERS,
)

__all__ = [
    "Job",
    "fetch_ats_jobs",
    "detect_ats",
    "detect_ats_in_html",
]
