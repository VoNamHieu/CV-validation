"""Facet matching (Phase-1 search): rank jobs against a CV-derived profile by
role-family adjacency × industry fit × location, with no LLM and no embedding.

Coarse + interpretable + tunable. Returns a score in [0,1] plus a breakdown so
the UI can explain "why" (and so the embedding/rerank layer can refine the top
bucket later). Works today on the in-memory featured aggregate; the same
scoring moves to SQL once jobs live in the store.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.data.taxonomy import classify_title, adjacent_families
from app.data.company_industry import classify_company

# accent-fold + lower for location matching (reuse taxonomy's normalizer shape)
from app.data.taxonomy import _norm  # noqa: E402


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


def score_job(job: dict, profile: SearchProfile, role_weights: dict[str, float],
              industry: str | None = None) -> dict | None:
    """Return {score, role_family, industry, role_w, in_domain} or None if the
    job's role family isn't reachable from the profile."""
    title = job.get("title") or ""
    fam, _ = classify_title(title)
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

    return {
        "score": round(role_w * ind_mult, 3),
        "role_family": fam, "industry": ind,
        "role_w": role_w, "in_domain": in_domain,
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
    scored.sort(key=lambda x: x["_facet"]["score"], reverse=True)
    return scored
