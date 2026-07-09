"""Embeddings for semantic retrieval (Phase 2).

gemini-embedding-001 truncated to 768-dim (Matryoshka) to match the planned
`vector(768)` column. Asymmetric task types: documents (jobs) vs query (CV).
Embedding ≠ generative LLM — cheap, batchable; in production this runs at INDEX
time per job (on JD change), not per search.
"""
from __future__ import annotations

import logging
import os
import re
import time

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
_BATCH = 100      # contents per API call
_MAX_RETRIES = 5  # per chunk, on 429 / transient errors
_BATCH_PAUSE = 0.4  # gentle pacing between batches (partial mode) to dodge rate limits


def _is_retryable(e: Exception) -> bool:
    """A transient 429 (rate limit / burst) or 5xx is worth a backoff-retry.
    A HARD billing/credit exhaustion is NOT — it's permanent until someone tops
    up, so retrying just burns minutes; fail fast (→ backup key → drop)."""
    s = str(e).lower()
    if any(m in s for m in ("credit", "depleted", "billing", "prepay")):
        return False
    return any(m in s for m in (
        "429", "resource_exhausted", "rate limit", "quota", "too many requests",
        "500", "503", "unavailable", "deadline", "timeout", "temporarily"))


def _embed_chunk(client, chunk, cfg) -> list[list[float]]:
    """One embed_content call with exponential backoff on 429/transient errors.
    Raises the last error if it never succeeds (caller decides how to handle)."""
    for attempt in range(_MAX_RETRIES):
        try:
            r = client.models.embed_content(model=_MODEL, contents=chunk, config=cfg)
            return [e.values for e in r.embeddings]
        except Exception as e:  # noqa: BLE001
            if attempt == _MAX_RETRIES - 1 or not _is_retryable(e):
                raise
            wait = min(60, 2 ** attempt * 2)  # 2, 4, 8, 16, 32s (capped 60)
            logger.info("embed: retry %d/%d after %ss (%s)",
                        attempt + 1, _MAX_RETRIES, wait, str(e)[:100])
            time.sleep(wait)
    return []  # unreachable


_backup_client = None
_backup_tried = False


def _get_backup_client():
    """Lazily build a client on GEMINI_API_KEY_BACKUP (if set) — the fallback for
    when the primary key is rate-limited OR out of prepaid credits (a hard 429
    that no retry recovers). None when no backup key is configured."""
    global _backup_client, _backup_tried
    if _backup_tried:
        return _backup_client
    _backup_tried = True
    key = os.getenv("GEMINI_API_KEY_BACKUP")
    if key:
        try:
            from google import genai
            _backup_client = genai.Client(api_key=key)
        except Exception as e:  # noqa: BLE001
            logger.info("embed: backup client init failed: %s", str(e)[:80])
    return _backup_client


def _embed(texts: list[str], task: str, *, partial: bool = False) -> list[list[float]]:
    """Embed ``texts`` in batches. Each batch tries the primary key (with backoff
    retries) then falls back to the backup key. ``partial=True`` (backfill): a
    batch that fails on ALL keys is DROPPED (empty vectors, output stays
    index-aligned) instead of aborting the whole run — those jobs stay unembedded
    and get retried next cycle. ``partial=False`` (query): re-raise."""
    from app.services.gemini_client import get_raw_client
    from google.genai import types
    cfg = types.EmbedContentConfig(output_dimensionality=DIM, task_type=task)
    clients = [get_raw_client()]
    backup = _get_backup_client()
    if backup is not None:
        clients.append(backup)

    out: list[list[float]] = []
    for i in range(0, len(texts), _BATCH):
        chunk = [t[:2000] or " " for t in texts[i:i + _BATCH]]
        vecs, last_err = None, None
        for idx, client in enumerate(clients):
            try:
                vecs = _embed_chunk(client, chunk, cfg)
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
                if idx + 1 < len(clients):
                    logger.info("embed: primary key failed for batch %d (%s) — trying backup key",
                                i // _BATCH, str(e)[:80])
        if vecs is not None:
            out.extend(vecs)
        elif not partial:
            raise last_err
        else:
            logger.warning("embed: batch %d dropped after all keys (%d items left unembedded): %s",
                           i // _BATCH, len(chunk), str(last_err)[:120])
            out.extend([[] for _ in chunk])  # keep alignment; backfill skips empties
            # Permanent failure (billing / credits) on every key → the rest will
            # fail identically. Stop burning calls; leave them for the next cycle.
            if last_err is not None and not _is_retryable(last_err):
                remaining = len(texts) - (i + _BATCH)
                if remaining > 0:
                    logger.warning("embed: all keys exhausted (permanent) — leaving %d items "
                                   "unembedded this run", remaining)
                    out.extend([[] for _ in range(remaining)])
                break
        if partial and i + _BATCH < len(texts):
            time.sleep(_BATCH_PAUSE)
    return out


def embed_jobs(docs: list[str]) -> list[list[float]]:
    """Embed job documents (title + JD snippet). INDEX-time in production.
    Resilient (partial): a rate-limited batch is skipped, not fatal — the rest
    still embed and the skipped jobs are retried on the next backfill."""
    return _embed(docs, "RETRIEVAL_DOCUMENT", partial=True)


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
