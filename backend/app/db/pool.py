"""Async Postgres (Supabase) connection pool + type codecs.

The backend talks to Supabase Postgres directly through the service-role
``DATABASE_URL`` (Supavisor pooler, session mode on :5432). That connection
**bypasses Row-Level Security**, so every user-scoped query MUST filter by
``user_id`` explicitly — the RLS policies (auth.uid()) are the *frontend's*
safety net for the day it talks to Supabase via supabase-js, not ours.

Codecs registered on every pooled connection:
  - ``vector`` (pgvector)  → encode/decode ``list[float]`` / numpy array
  - ``jsonb`` / ``json``   → encode/decode Python dict/list via ``json``

``statement_cache_size=0`` is set because Supavisor recycles server-side
connections; cached prepared-statement names can collide otherwise.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

import asyncpg
from pgvector.asyncpg import register_vector

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Per-connection setup: vector + jsonb codecs."""
    await register_vector(conn)
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )
    await conn.set_type_codec(
        "json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )


async def get_pool() -> asyncpg.Pool:
    """Return the process-wide pool, creating it lazily on first use."""
    global _pool
    if _pool is None:
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL is not set — cannot open DB pool")
        _pool = await asyncpg.create_pool(
            dsn,
            min_size=1,
            max_size=int(os.getenv("DB_POOL_MAX", "10")),
            statement_cache_size=0,  # Supavisor pooler safety
            init=_init_connection,
            command_timeout=30,
        )
        logger.info("DB pool created (max_size=%s)", _pool.get_max_size())
    return _pool


async def close_pool() -> None:
    """Close the pool on app shutdown."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("DB pool closed")


async def ping() -> bool:
    """Lightweight connectivity check (used by /health/db)."""
    pool = await get_pool()
    return await pool.fetchval("SELECT 1") == 1


def row_to_dict(record: Optional[asyncpg.Record]) -> Optional[dict]:
    """asyncpg Record → plain dict (None passthrough). UUID/datetime are left
    as-is; FastAPI's jsonable_encoder serializes them downstream."""
    return dict(record) if record is not None else None


def rows_to_dicts(records) -> list[dict]:
    return [dict(r) for r in records]
