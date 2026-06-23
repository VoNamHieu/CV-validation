"""CV → SearchProfile (the "empathize" distill step).

Turns a CV / free-text into the search intent the facet layer consumes:
target roles (incl. adjacent pivots), domains, seniority, locations. The LLM is
constrained to the controlled vocabulary (INDUSTRIES) so domains come back
canonical; role families are derived deterministically from the role strings
via classify_title (no free-text family drift).
"""
from __future__ import annotations

import json
import logging

from app.search.facet import SearchProfile
from app.search.taxonomy import classify_title, INDUSTRIES

logger = logging.getLogger(__name__)

_LEVELS = ("Intern/Fresher", "Junior", "Mid", "Senior", "Lead/Manager", "Director/Head+")


def build_profile(target_roles: list[str], domains: list[str] | None = None,
                  level: str = "", desired_locations: list[str] | None = None,
                  salary_floor: int = 0) -> SearchProfile:
    """Deterministic: map role strings → role families (primary order preserved),
    keep only canonical domains."""
    fams: list[str] = []
    for r in target_roles or []:
        fam, _ = classify_title(r)
        if fam not in fams:
            fams.append(fam)
    domains = [d for d in (domains or []) if d in INDUSTRIES]
    return SearchProfile(
        role_families=fams or ["General & Management"],
        domains=domains,
        desired_locations=[d for d in (desired_locations or []) if d],
        level=level if level in _LEVELS else "",
        salary_floor=salary_floor or 0,
    )


_SYS = (
    "You distill a CV into job-search intent for Vietnam. Return ONLY JSON:\n"
    '{"target_roles": [..], "domains": [..], "seniority": "..", '
    '"desired_locations": [..], "salary_floor": <int VND or 0>}\n'
    "Rules:\n"
    "- target_roles: 3–6 job titles the candidate fits, INCLUDING adjacent/pivot "
    "roles (e.g. a PM also fits Business Analyst, Project Manager). Plain titles.\n"
    f"- domains: 0–3 from EXACTLY this list (verbatim), else omit: {list(INDUSTRIES)}\n"
    f"- seniority: one of {list(_LEVELS)}\n"
    "- desired_locations: VN cities the CV implies/prefers, else [].\n"
    "- Intent over raw history: if the CV signals a pivot, lead with the target role."
)


def distill_from_cv(cv_text: str) -> SearchProfile:
    """LLM distill → SearchProfile. Falls back to an empty profile on failure
    (caller can still pass explicit fields)."""
    from app.services.gemini_client import generate_json
    try:
        raw = generate_json(_SYS, (cv_text or "")[:8000])
        d = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except Exception as e:
        logger.info(f"[profile] distill failed: {str(e)[:80]}")
        d = {}
    return build_profile(
        d.get("target_roles", []), d.get("domains", []),
        d.get("seniority", ""), d.get("desired_locations", []),
        int(d.get("salary_floor") or 0),
    )
