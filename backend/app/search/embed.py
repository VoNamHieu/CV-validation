"""Embeddings for semantic retrieval (Phase 2).

gemini-embedding-001 truncated to 768-dim (Matryoshka) to match the planned
`vector(768)` column. Asymmetric task types: documents (jobs) vs query (CV).
Embedding ≠ generative LLM — cheap, batchable; in production this runs at INDEX
time per job (on JD change), not per search.
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# Rank / title words carry NO domain signal but dominate short VN job titles
# ("Chuyên viên X" ≈ "Specialist of X"), so the embedding cosine treats every
# "Chuyên viên …" as similar regardless of field. Seniority is already a
# SEPARATE axis (classify_seniority × _seniority_mult), so we strip rank here
# and let the vector encode the DOMAIN only. Leading [Hanoi]/(HCM) tags and
# numeric id prefixes are stripped too; trailing domain parens are kept.
_TITLE_TAG = re.compile(r'^\s*(?:[\[(][^\])]*[\])]\s*|\d{5,}\s*-\s*)+')
_TITLE_NOISE = re.compile(
    r'\b(chuyên viên chính|chuyên viên cao cấp|chuyên viên|nhân viên|cán bộ|chuyên gia|'
    r'trưởng phòng|phó phòng|trưởng nhóm|trưởng bộ phận|tổ trưởng|đội trưởng|giám đốc|'
    r'phó giám đốc|trợ lý|thực tập sinh|cvcc|cvc|senior|junior|associate|assistant|'
    r'executive|officer|specialist|staff|intern|fresher|trainee|manager|head of|early career)\b',
    re.I)


def strip_title_noise(title: str) -> str:
    """Drop rank/title words so the embedding focuses on the domain, not the
    seniority (which is scored on its own axis). Falls back to the original if
    stripping would empty it."""
    s = _TITLE_TAG.sub('', title or '')
    s = _TITLE_NOISE.sub(' ', s)
    s = re.sub(r'\s{2,}', ' ', s).strip(' -|/,')
    return s or (title or '').strip()

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
    parts = [strip_title_noise(title)]
    if must_have:
        parts.append("Skills: " + ", ".join(must_have[:8]))
    if jd:
        parts.append(jd[:600])
    return " | ".join(p for p in parts if p)
