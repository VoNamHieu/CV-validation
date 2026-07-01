"""Facet matching (Phase-1 search): rank jobs against a CV-derived profile by
role-family adjacency × industry fit × location, with no LLM and no embedding.

Coarse + interpretable + tunable. Returns a score in [0,1] plus a breakdown so
the UI can explain "why" (and so the embedding/rerank layer can refine the top
bucket later). Works today on the in-memory featured aggregate; the same
scoring moves to SQL once jobs live in the store.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from app.search.taxonomy import (
    classify_title, adjacent_families, classify_seniority, level_index,
    canon_level, FULL_CONFIDENCE, SENIORITY_LEVELS,
)
from app.search.company_industry import classify_company

# accent-fold + lower for location matching (reuse taxonomy's normalizer shape)
from app.search.taxonomy import _norm  # noqa: E402

logger = logging.getLogger(__name__)


@dataclass
class SearchProfile:
    role_families: list[str] = field(default_factory=list)  # primary first (DIRECTION)
    domains: list[str] = field(default_factory=list)        # preferred industries
    desired_locations: list[str] = field(default_factory=list)
    level: str = ""
    salary_floor: int = 0
    # Candidate's years of professional experience (0 = unknown → years-fit
    # stays neutral). Lets ranking demote jobs whose stated minimum years
    # out-reach the candidate — the SAME signal the optimize pipeline uses, so
    # a job can't rank #1 here and then read "too much experience" downstream.
    candidate_years: int = 0
    adjacency_threshold: float = 0.5
    # The candidate's PROVEN role families (from the CV) — the CONSTRAINT axis.
    # role_families is where they want to go; cv_families is what they can show.
    # Empty → fit is neutral (fully backward-compatible).
    cv_families: list[str] = field(default_factory=list)

    def expanded_roles(self) -> dict[str, float]:
        """All role families to retrieve, with weight (self=1.0, pivots decay)."""
        out: dict[str, float] = {}
        for rf in self.role_families:
            for fam, w in adjacent_families(rf, self.adjacency_threshold).items():
                out[fam] = max(out.get(fam, 0.0), w)
        return out


# weight of the industry signal vs the role signal in the blended score
_OUT_OF_DOMAIN = 0.6   # multiplier when job industry not in profile.domains

# A role family with NO adjacency path to the profile is demoted to this floor
# instead of being dropped — so every role stays SEARCHABLE (a candidate can
# pivot INTO any family, incl. graph orphans like HR/Legal/Manufacturing) but
# ranks at the very bottom, behind every reachable family. is_primary tiering +
# score ordering keep these last. Universal (graph-structure, not per-pair).
_UNREACHABLE_FLOOR = 0.25

# CV-as-constraint: a job whose family is far from the candidate's PROVEN
# (CV) family is demoted to this floor, never zeroed — direction still steers,
# the CV just shades feasibility.
_FIT_FLOOR = 0.4
# How many seniority levels a FULL fit mismatch (fit_mult→floor) discounts the
# candidate by, when judging level fit in a pivot direction.
_LEVEL_DISCOUNT_SPAN = 2


def _fit_mult(job_fam: str, cv_families: list[str]) -> float:
    """How transferable the candidate's proven CV family(s) are into `job_fam`,
    via the SAME adjacency graph: same family → 1.0, adjacent → the edge weight,
    far → `_FIT_FLOOR`. No CV families → 1.0 (neutral / backward-compatible).
    Role-agnostic: the graph does the work, no role pair is named."""
    if not cv_families:
        return 1.0
    best = 0.0
    for cvf in cv_families:
        best = max(best, adjacent_families(cvf, 0.0).get(job_fam, 0.0))
    return max(best, _FIT_FLOOR)


def _effective_level(profile_level: str, fit_mult: float) -> str:
    """A candidate's CAREER seniority doesn't fully transfer into a role family
    they haven't proven. For a pivot (fit_mult < 1.0) discount the level toward
    entry in proportion to the gap, so entry roles in the new direction stop
    being demoted and senior/head roles get demoted harder. Same family or no CV
    (fit_mult == 1.0) → unchanged."""
    pi = level_index(profile_level or "")
    if pi is None or fit_mult >= 1.0:
        return profile_level
    # round-half-UP (not Python's banker's round, which would zero the discount
    # at the exact 0.5 tie — i.e. fit_mult=0.75, a common edge weight — making a
    # genuine pivot escape its level discount and the curve non-monotonic).
    drop = int((1.0 - fit_mult) * _LEVEL_DISCOUNT_SPAN + 0.5)
    eff = max(pi - drop, 0)   # floor at Intern; discount never RAISES the level
    return SENIORITY_LEVELS[eff]


# ── Experience-years fit (rank, don't drop) ──────────────────────────────────
# "5+ years", "ít nhất 3 năm", "3-5 years" → the minimum. Same intent as the
# frontend's requiredYearsFromJd; kept as a cheap regex (no LLM at rank time).
_YEARS_RE = re.compile(r"(\d{1,2})(?:\.\d+)?\s*\+?\s*(?:years?|yrs?|năm|nam)", re.I)


def _required_years(job: dict) -> int | None:
    """Minimum years a job asks for, or None when no usable signal.
    Prefers a pre-indexed `required_years_min`; else scans the available text
    (title + description + must_have). Takes the LOWER bound across matches so
    ranking never OVER-demotes on an incidental large number."""
    rym = job.get("required_years_min")
    if isinstance(rym, (int, float)) and rym > 0:
        return int(rym)
    parts = [str(job.get("title") or ""), str(job.get("description") or "")]
    mh = job.get("must_have")
    if isinstance(mh, (list, tuple)):
        parts.append(" ".join(str(x) for x in mh))
    elif isinstance(mh, str):
        parts.append(mh)
    best: int | None = None
    for m in _YEARS_RE.finditer(" ".join(parts)):
        v = int(m.group(1))
        if 0 < v <= 30:  # ignore junk like "10000 nhân viên"
            best = v if best is None else min(best, v)
    return best


def _years_fit(required: int | None, candidate_years: int) -> float:
    """Demote (never drop) a job whose minimum years out-reach the candidate.
    Unknown requirement or unknown candidate years → neutral (1.0). A 1-year
    stretch is fine; the demote deepens with the gap so far-reaches sink."""
    if not required or candidate_years <= 0:
        return 1.0
    gap = required - candidate_years
    if gap <= 1:
        return 1.0
    if gap == 2:
        return 0.7
    if gap == 3:
        return 0.5
    return 0.35


def _seniority_mult(job_level: str | None, profile_level: str) -> float:
    """Demote a job whose level doesn't fit the candidate — BOTH directions.
    Below-level (an intern role for a mid PM) is a step down; above-level (a
    Head/Director role for a mid) is a stretch the candidate likely can't land.
    A one-level stretch up is only mildly demoted (worth surfacing); two+ levels
    either way is demoted hard. Unknown PROFILE level → neutral.

    A job title with NO level word (bare "Product Manager", "Chuyên viên") is
    assumed Mid (the modal IC level) so its level still participates — but since
    that's a guess, it only fires on a CLEAR gap (>=2 levels); a 1-level
    difference stays neutral so a wrong default can't flip a near-fit."""
    pi = level_index(profile_level or "")
    if pi is None:
        return 1.0
    ji = level_index(job_level or "")
    defaulted = ji is None
    if defaulted:
        ji = level_index("Mid")
    gap = pi - ji                       # > 0 ⇒ below candidate; < 0 ⇒ above
    if defaulted:
        # Assumed level — act only on a clear mismatch, never on near-fits.
        if gap >= 2:
            return 0.4
        if gap <= -2:
            return 0.35
        return 1.0
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
    """Return {score, role_family, industry, role_w, in_domain, reachable, ...},
    or None ONLY when a job is dropped by the location filter.

    The blended score is role_w × industry × classification-confidence ×
    seniority-fit, so (a) a title we could only land on the General & Management
    catch-all (low confidence) scores well below a confident match, and (b) a
    role below the candidate's level is demoted instead of riding its family
    adjacency weight.

    A family with no adjacency path to the profile is NOT dropped — it's demoted
    to `_UNREACHABLE_FLOOR` and flagged `reachable=False`, so it ranks dead last
    (behind every reachable family) but stays visible/pivot-able."""
    title = job.get("title") or ""
    fam, conf = classify_title(title)
    role_w = role_weights.get(fam, 0.0)
    reachable = role_w > 0
    if not reachable:
        role_w = _UNREACHABLE_FLOOR   # soft floor — demote to the tail, don't drop

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

    # CV-as-constraint: how transferable the candidate's proven family is into
    # this job's family (1.0 when same / no CV given). Also discounts the level
    # they're judged at, so a pivot's career seniority doesn't transfer wholesale.
    fit_mult = _fit_mult(fam, profile.cv_families)
    # Seniority signal: prefer a stored/body-derived seniority (set at ingest)
    # over re-classifying the bare title — a title like "Product Manager" carries
    # no level word and would otherwise default to Mid. Fall back to the title
    # classifier when nothing is stored.
    job_level = canon_level(str(job.get("seniority") or "")) or classify_seniority(title)
    eff_level = _effective_level(profile.level, fit_mult)
    sen_mult = _seniority_mult(job_level, eff_level)

    # Experience-years fit: demote (never drop) jobs whose minimum years
    # out-reach the candidate — makes ranking agree with the optimize pipeline
    # so a job can't appear #1 here then get rejected there for "too much
    # experience". Neutral when either side's years are unknown.
    req_years = _required_years(job)
    years_mult = _years_fit(req_years, profile.candidate_years)

    # Primary = the candidate's OWN role family (e.g. Product). Adjacent families
    # (Analyst/BA, Consultant…) are reachable but must rank as a separate, lower
    # tier — we only widen to them after the primary pool is exhausted, not mix
    # an in-domain BA above an out-of-domain PM.
    is_primary = fam in profile.role_families

    return {
        "score": round(role_w * ind_mult * conf_mult * sen_mult * fit_mult * years_mult, 3),
        "role_family": fam, "industry": ind, "is_primary": is_primary,
        "role_w": role_w, "in_domain": in_domain, "reachable": reachable,
        "confidence": conf, "seniority": job_level, "seniority_mult": sen_mult,
        "fit_mult": round(fit_mult, 2), "eff_level": eff_level,
        "required_years": req_years, "years_mult": years_mult,
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
    # Three tiers, in order: primary role-family → reachable adjacent → soft-
    # floored unreachable (pivot-only). Within each tier, by score. So an
    # unreachable-family job can never outrank a reachable one even if its raw
    # score happens higher; "exact role first, widen, then everything else last".
    scored.sort(key=lambda x: (x["_facet"].get("is_primary", False),
                               x["_facet"].get("reachable", True),
                               x["_facet"]["score"]), reverse=True)

    if logger.isEnabledFor(logging.INFO):
        floored = sum(1 for j in scored if not j["_facet"].get("reachable", True))
        logger.info(
            "[facet] profile roles=%s domains=%s level=%r → expanded=%s | "
            "%d/%d jobs scored (%d soft-floored / unreachable)",
            profile.role_families, profile.domains, profile.level,
            {k: round(v, 2) for k, v in rw.items()}, len(scored), len(jobs), floored,
        )
        for j in scored[:12]:
            f = j["_facet"]
            logger.info(
                "[facet]   %.3f %s fam=%s conf=%.1f role_w=%.2f fit=%.2f "
                "in_domain=%s sen=%s×%.2f | %s",
                f["score"], "P" if f["is_primary"] else "·", f["role_family"],
                f["confidence"], f["role_w"], f.get("fit_mult", 1.0), f["in_domain"],
                f.get("seniority"), f["seniority_mult"],
                (j.get("title") or "")[:60],
            )
    return scored
