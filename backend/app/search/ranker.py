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
           vec_key=lambda j: j.get("_vec")) -> list[dict]:
    """Each job needs a facet score (Phase 1) + an embedding (_vec). Returns the
    list re-sorted by blended score, annotating _cos and _final."""
    for j in jobs:
        cos = cosine(query_vec, vec_key(j) or [])
        j["_cos"] = round(cos, 4)
        j["_final"] = round(_W_FACET * facet_key(j) + _W_COS * cos, 4)
    jobs.sort(key=lambda j: j["_final"], reverse=True)
    return jobs
