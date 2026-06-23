"""Embeddings for semantic retrieval (Phase 2).

gemini-embedding-001 truncated to 768-dim (Matryoshka) to match the planned
`vector(768)` column. Asymmetric task types: documents (jobs) vs query (CV).
Embedding ≠ generative LLM — cheap, batchable; in production this runs at INDEX
time per job (on JD change), not per search.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_MODEL = "gemini-embedding-001"
DIM = 768
_BATCH = 100  # contents per API call


def _embed(texts: list[str], task: str) -> list[list[float]]:
    from app.services.gemini_client import get_raw_client
    from google.genai import types
    client = get_raw_client()
    cfg = types.EmbedContentConfig(output_dimensionality=DIM, task_type=task)
    out: list[list[float]] = []
    for i in range(0, len(texts), _BATCH):
        chunk = [t[:2000] or " " for t in texts[i:i + _BATCH]]
        r = client.models.embed_content(model=_MODEL, contents=chunk, config=cfg)
        out.extend(e.values for e in r.embeddings)
    return out


def embed_jobs(docs: list[str]) -> list[list[float]]:
    """Embed job documents (title + JD snippet). INDEX-time in production."""
    return _embed(docs, "RETRIEVAL_DOCUMENT")


def embed_query(text: str) -> list[float]:
    """Embed the CV-derived search intent (query side)."""
    return _embed([text], "RETRIEVAL_QUERY")[0]


def build_job_doc(title: str, jd: str = "", must_have: list[str] | None = None) -> str:
    """Only the discriminative part — title + must-haves + a JD snippet.
    Don't dump the whole posting (dilutes the vector)."""
    parts = [title or ""]
    if must_have:
        parts.append("Skills: " + ", ".join(must_have[:8]))
    if jd:
        parts.append(jd[:600])
    return " | ".join(p for p in parts if p)
