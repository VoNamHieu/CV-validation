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
from app.search.taxonomy import (
    classify_title, INDUSTRIES, _norm, SENIORITY_LEVELS, canon_level,
)

logger = logging.getLogger(__name__)

_LEVELS = SENIORITY_LEVELS

# Free-text domain → canonical INDUSTRY. The LLM distill is constrained to the
# vocab, but explicit-field API callers pass loose terms ("fintech", "tech"); map
# them so the industry filter isn't silently dropped. Keys are _norm'd at lookup.
_DOMAIN_ALIASES = {
    # NB: _norm keeps hyphens, so the hyphenated spelling needs its own key —
    # "E-commerce" (the most common form) was silently dropped without it.
    "ecommerce": "E-commerce & Marketplace", "e commerce": "E-commerce & Marketplace",
    "e-commerce": "E-commerce & Marketplace",
    "marketplace": "E-commerce & Marketplace", "retail tech": "E-commerce & Marketplace",
    "saas": "Technology Platform / SaaS", "tech": "Technology Platform / SaaS",
    "technology": "Technology Platform / SaaS", "software": "Technology Platform / SaaS",
    "platform": "Technology Platform / SaaS", "internet": "Technology Platform / SaaS",
    "ai": "Technology Platform / SaaS", "consumer apps": "Technology Platform / SaaS",
    "enterprise software": "Technology Platform / SaaS",
    "beauty": "FMCG & Consumer Goods",
    "financial services": "Banking",
    "fintech": "Fintech & Payments", "payments": "Fintech & Payments",
    "payment": "Fintech & Payments",
    "it services": "IT Services / Outsourcing", "outsourcing": "IT Services / Outsourcing",
    "software outsourcing": "IT Services / Outsourcing", "it outsourcing": "IT Services / Outsourcing",
    "bank": "Banking", "banking": "Banking",
    "securities": "Securities & Investment", "investment": "Securities & Investment",
    "brokerage": "Securities & Investment", "asset management": "Securities & Investment",
    "insurance": "Insurance", "insurtech": "Insurance",
    "fmcg": "FMCG & Consumer Goods", "consumer goods": "FMCG & Consumer Goods",
    "cpg": "FMCG & Consumer Goods",
    "retail": "Retail",
    "logistics": "Logistics & Delivery", "delivery": "Logistics & Delivery",
    "shipping": "Logistics & Delivery", "supply chain": "Logistics & Delivery",
    "manufacturing": "Manufacturing & Semiconductor", "semiconductor": "Manufacturing & Semiconductor",
    "semi": "Manufacturing & Semiconductor",
    "energy": "Industrial / Energy / Auto", "automotive": "Industrial / Energy / Auto",
    "auto": "Industrial / Energy / Auto", "industrial": "Industrial / Energy / Auto",
    "oil and gas": "Industrial / Energy / Auto",
    "pharma": "Pharma & Healthcare", "pharmaceutical": "Pharma & Healthcare",
    "healthcare": "Pharma & Healthcare", "health": "Pharma & Healthcare",
    "medical": "Pharma & Healthcare", "healthtech": "Pharma & Healthcare",
    "consulting": "Consulting & Professional", "advisory": "Consulting & Professional",
    "professional services": "Consulting & Professional",
    "agency": "Agency / Media / Marketing", "media": "Agency / Media / Marketing",
    "marketing": "Agency / Media / Marketing", "advertising": "Agency / Media / Marketing",
    "hospitality": "Hospitality & Travel", "travel": "Hospitality & Travel",
    "tourism": "Hospitality & Travel", "hotel": "Hospitality & Travel",
    "education": "Education", "edtech": "Education", "edu": "Education",
    "conglomerate": "Conglomerate / Other",
}
_CANON_BY_NORM = {_norm(i): i for i in INDUSTRIES}


def canon_domains(domains: list[str] | None) -> list[str]:
    """Map loose domain strings to canonical INDUSTRIES (alias or exact, accent/
    case-insensitive); drop unknowns. Order preserved, deduped."""
    out: list[str] = []
    for d in domains or []:
        n = _norm(d)
        canon = _CANON_BY_NORM.get(n) or _DOMAIN_ALIASES.get(n)
        if canon and canon not in out:
            out.append(canon)
    return out


def families_from_roles(roles: list[str]) -> list[str]:
    """Distinct role families for a list of role-title strings, order preserved.
    Shared by build_profile (direction) and the CV-fit constraint (cv_families)."""
    fams: list[str] = []
    for r in roles or []:
        fam, _ = classify_title(r)
        if fam not in fams:
            fams.append(fam)
    return fams


def build_profile(target_roles: list[str], domains: list[str] | None = None,
                  level: str = "", desired_locations: list[str] | None = None,
                  salary_floor: int = 0) -> SearchProfile:
    """Deterministic: map role strings → role families (primary order preserved),
    keep only canonical domains."""
    fams = families_from_roles(target_roles)
    domains = canon_domains(domains)
    return SearchProfile(
        role_families=fams or ["General & Management"],
        domains=domains,
        desired_locations=[d for d in (desired_locations or []) if d],
        level=canon_level(level),
        salary_floor=salary_floor or 0,
    )


_SYS = (
    "You distill a CV into job-search intent for Vietnam. Return ONLY JSON:\n"
    '{"target_roles": [..], "domains": [..], "seniority": "..", '
    '"desired_locations": [..], "salary_floor": <int VND or 0>}\n'
    "Rules:\n"
    "- target_roles: 1–3 job titles the candidate is ACTUALLY targeting — their "
    "core role, plus a genuine pivot ONLY if the CV clearly signals one. Do NOT "
    "pad with merely-adjacent roles (e.g. don't add Business Analyst for a PM) — "
    "the search engine widens to adjacent families itself and ranks them below "
    "the primary role. Plain titles.\n"
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
        if isinstance(d, list):                       # model returned an array
            d = next((x for x in d if isinstance(x, dict)), {})
        if not isinstance(d, dict):
            d = {}
    except Exception as e:
        logger.info(f"[profile] distill failed: {str(e)[:80]}")
        d = {}
    return build_profile(
        d.get("target_roles", []), d.get("domains", []),
        d.get("seniority", ""), d.get("desired_locations", []),
        int(d.get("salary_floor") or 0),
    )
