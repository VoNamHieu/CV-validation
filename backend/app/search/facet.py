"""Facet matching (Phase-1 search): rank jobs against a CV-derived profile by
role-family adjacency × industry fit × location, with no LLM and no embedding.

Coarse + interpretable + tunable. Returns a score in [0,1] plus a breakdown so
the UI can explain "why" (and so the embedding/rerank layer can refine the top
bucket later). Works today on the in-memory featured aggregate; the same
scoring moves to SQL once jobs live in the store.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.search.taxonomy import (
    classify_title, adjacent_families, classify_seniority, level_index,
    FULL_CONFIDENCE,
)
from app.search.company_industry import classify_company

# accent-fold + lower for location matching (reuse taxonomy's normalizer shape)
from app.search.taxonomy import _norm  # noqa: E402


@dataclass
class SearchProfile:
    role_families: list[str] = field(default_factory=list)  # primary first
    domains: list[str] = field(default_factory=list)        # preferred industries
    desired_locations: list[str] = field(default_factory=list)
    level: str = ""
    salary_floor: int = 0
    adjacency_threshold: float = 0.5

    def expanded_roles(self) -> dict[str, float]:
        """All role families to retrieve, with weight (self=1.0, pivots decay)."""
        out: dict[str, float] = {}
        for rf in self.role_families:
            for fam, w in adjacent_families(rf, self.adjacency_threshold).items():
                out[fam] = max(out.get(fam, 0.0), w)
        return out


# weight of the industry signal vs the role signal in the blended score
_OUT_OF_DOMAIN = 0.6   # multiplier when job industry not in profile.domains


def _seniority_mult(job_level: str | None, profile_level: str) -> float:
    """Demote a job whose level doesn't fit the candidate — BOTH directions.
    Below-level (an intern role for a mid PM) is a step down; above-level (a
    Head/Director role for a mid) is a stretch the candidate likely can't land.
    A one-level stretch up is only mildly demoted (worth surfacing); two+ levels
    either way is demoted hard. Unknown on either side → neutral, so an
    unclassifiable title is never penalised."""
    ji = level_index(job_level or "")
    pi = level_index(profile_level or "")
    if ji is None or pi is None:
        return 1.0
    gap = pi - ji                       # > 0 ⇒ below candidate; < 0 ⇒ above
    if gap == 0:
        return 1.0
    if gap == 1:
        return 0.8                      # one level below — mild
    if gap >= 2:
        return 0.4                      # well below — strong
    if gap == -1:
        return 0.75                     # one level above — a stretch, still show
    return 0.35                         # two+ levels above (Head/Director) — strong


def score_job(job: dict, profile: SearchProfile, role_weights: dict[str, float],
              industry: str | None = None) -> dict | None:
    """Return {score, role_family, industry, role_w, in_domain, ...} or None if
    the job's role family isn't reachable from the profile.

    The blended score is role_w × industry × classification-confidence ×
    seniority-fit, so (a) a title we could only land on the General & Management
    catch-all (low confidence) scores well below a confident match, and (b) a
    role below the candidate's level is demoted instead of riding its family
    adjacency weight."""
    title = job.get("title") or ""
    fam, conf = classify_title(title)
    role_w = role_weights.get(fam, 0.0)
    if role_w <= 0:
        return None

    # hard-ish location filter: if user set locations, require overlap
    if profile.desired_locations:
        loc = _norm(job.get("location") or "")
        if loc and not any(_norm(d) in loc for d in profile.desired_locations):
            return None  # tagged with a location, none match → drop

    ind = industry if industry is not None else classify_company(
        job.get("company", ""), job.get("career_url", ""))
    in_domain = bool(profile.domains) and ind in profile.domains
    ind_mult = 1.0 if (in_domain or not profile.domains) else _OUT_OF_DOMAIN

    # Fold the classification confidence so the @0.3 catch-all can't masquerade
    # as a full-weight family match (a confident rule match → 1.0, no change).
    conf_mult = min(1.0, conf / FULL_CONFIDENCE)
    job_level = classify_seniority(title)
    sen_mult = _seniority_mult(job_level, profile.level)

    # Primary = the candidate's OWN role family (e.g. Product). Adjacent families
    # (Analyst/BA, Consultant…) are reachable but must rank as a separate, lower
    # tier — we only widen to them after the primary pool is exhausted, not mix
    # an in-domain BA above an out-of-domain PM.
    is_primary = fam in profile.role_families

    return {
        "score": round(role_w * ind_mult * conf_mult * sen_mult, 3),
        "role_family": fam, "industry": ind, "is_primary": is_primary,
        "role_w": role_w, "in_domain": in_domain,
        "confidence": conf, "seniority": job_level, "seniority_mult": sen_mult,
    }


def rank_jobs(jobs: list[dict], profile: SearchProfile) -> list[dict]:
    """Each job → {**job, _facet: {...}} sorted by score desc. `jobs` carry at
    least `title`; `company`/`industry`/`location` improve precision."""
    rw = profile.expanded_roles()
    scored = []
    for j in jobs:
        s = score_job(j, profile, rw, industry=j.get("industry"))
        if s:
            scored.append({**j, "_facet": s})
    # Tier by primary role-family first (PM/PO before any BA/Analyst/Consultant),
    # then by score within each tier — "exact role first, widen only after".
    scored.sort(key=lambda x: (x["_facet"].get("is_primary", False),
                               x["_facet"]["score"]), reverse=True)
    return scored
