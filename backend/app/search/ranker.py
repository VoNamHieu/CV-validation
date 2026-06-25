"""Phase-2 rerank: order facet matches by semantic CV↔job similarity.

Facet (Phase 1) gives the right COARSE bucket fast; the top bucket saturates
(many jobs tie at the same facet score) and facet can't order within it. This
layer breaks those ties with embedding cosine — the meaningful ordering for a
specific CV. Blend keeps facet as the gate (coarse, interpretable) and cosine
as the in-bucket sorter.
"""
from __future__ import annotations

import math


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
           tier_key=lambda j: j["_facet"].get("is_primary", False)) -> list[dict]:
    """Each job needs a facet score (Phase 1) + an embedding (_vec). Returns the
    list re-sorted by blended score WITHIN the primary tier, annotating _cos and
    _final.

    Cosine orders within a tier — it must NOT cross it. Phase-1 puts the
    candidate's own role family (primary) above adjacent families; if we sorted
    the whole bucket by the blended score alone, an in-domain adjacent job (e.g.
    a bank "Strategy"/"Project Manager"/consultant on the General & Management
    catch-all, facet ~0.85) with a decent cosine would leapfrog an out-of-domain
    PRIMARY job (e.g. an out-of-sector Product Manager, facet ~0.6) — exactly the
    off-role leak we don't want. Tier first, blend within."""
    for j in jobs:
        cos = cosine(query_vec, vec_key(j) or [])
        j["_cos"] = round(cos, 4)
        j["_final"] = round(_W_FACET * facet_key(j) + _W_COS * cos, 4)
    jobs.sort(key=lambda j: (tier_key(j), j["_final"]), reverse=True)
    return jobs
