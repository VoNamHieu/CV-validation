"""Tiny async JSON cache backed by Redis, with a graceful no-op fallback.

If REDIS_URL is unset (local dev, CI) or Redis is unreachable, every call
becomes a miss / no-op and the caller falls back to its own in-memory cache —
so the app keeps working without a Redis service. On Railway, add the Redis
plugin and it injects REDIS_URL automatically.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL")
_client: Any = None
_init_failed = False


def _get_client():
    """Lazily build a shared async Redis client, or None if unavailable."""
    global _client, _init_failed
    if _client is not None or _init_failed:
        return _client
    if not _REDIS_URL:
        _init_failed = True  # no URL → permanently disabled, no log spam
        return None
    try:
        import redis.asyncio as redis  # lazy: only needed when REDIS_URL is set

        _client = redis.from_url(_REDIS_URL, decode_responses=True)
        logger.info("[cache] Redis client initialised")
    except Exception as e:
        logger.warning(f"[cache] Redis init failed, falling back to in-memory: {e}")
        _init_failed = True
        _client = None
    return _client


async def get_json(key: str) -> Optional[Any]:
    """Return the decoded value for `key`, or None on miss / any error."""
    client = _get_client()
    if client is None:
        return None
    try:
        raw = await client.get(key)
        return json.loads(raw) if raw else None
    except Exception as e:
        logger.warning(f"[cache] get({key}) failed: {e}")
        return None


async def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    """Store `value` as JSON under `key` with a TTL. Best-effort (never raises)."""
    client = _get_client()
    if client is None:
        return
    try:
        await client.set(key, json.dumps(value), ex=ttl_seconds)
    except Exception as e:
        logger.warning(f"[cache] set({key}) failed: {e}")
