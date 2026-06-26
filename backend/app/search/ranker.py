"""Phase-2 rerank: order facet matches by semantic CV↔job similarity.

Facet (Phase 1) gives the right COARSE bucket fast; the top bucket saturates
(many jobs tie at the same facet score) and facet can't order within it. This
layer breaks those ties with embedding cosine — the meaningful ordering for a
specific CV. Blend keeps facet as the gate (coarse, interpretable) and cosine
as the in-bucket sorter.
"""
from __future__ import annotations

import math

from app.search.taxonomy import _norm


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


# blend weights: facet stays the gate, cosine orders within the tier
_W_FACET = 0.7
_W_COS = 0.3


def rerank(query_vec: list[float], jobs: list[dict],
           facet_key=lambda j: j["_facet"]["score"],
           vec_key=lambda j: j.get("_vec"),
           tier_key=lambda j: j["_facet"].get("is_primary", False),
           query_phrase: str = "") -> list[dict]:
    """Each job needs a facet score (Phase 1) + an embedding (_vec). Returns the
    list re-sorted by (literal, tier, blended score), annotating _cos/_final/_literal.

    Cosine orders within a tier — it must NOT cross it. Phase-1 puts the
    candidate's own role family (primary) above adjacent families; sorting the
    whole bucket by blended score alone lets an in-domain adjacent catch-all job
    leapfrog an out-of-domain PRIMARY job — the off-role leak. Tier first.

    LITERAL hybrid: if the job title contains the query's domain PHRASE verbatim
    (e.g. a title that literally says "xuất nhập khẩu"), it joins the TOP tier
    regardless of family — recovering exact matches the family/embedding layers
    bury, while a contiguous-phrase test (not loose tokens) avoids Vietnamese
    polysemy collisions ("thu nhập"=income, "sản xuất"=production)."""
    qn = _norm(query_phrase)
    # A 1-2 char phrase is too weak to anchor on; require something substantial.
    use_literal = len(qn) >= 4
    for j in jobs:
        cos = cosine(query_vec, vec_key(j) or [])
        lit = use_literal and qn in _norm(j.get("title", ""))
        j["_cos"] = round(cos, 4)
        j["_literal"] = lit
        j["_final"] = round(_W_FACET * facet_key(j) + _W_COS * cos, 4)
    jobs.sort(key=lambda j: (j.get("_literal", False), tier_key(j), j["_final"]), reverse=True)
    return jobs
