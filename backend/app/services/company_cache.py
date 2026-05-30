"""
SQLite cache for resolved companies.

Maps a TopCV/VNW URL (or a normalized company name) → company website. Avoids
re-scraping the same company across requests.

Schema (single table):
    companies (
        id           INTEGER PRIMARY KEY AUTOINCREMENT
        name         TEXT                -- display name, as scraped
        name_key     TEXT                -- normalized (lowercased, accents stripped)
        website_url  TEXT
        source       TEXT                -- "topcv_profile" | "topcv_job" | "vnw_job" | ...
        source_url   TEXT  UNIQUE        -- original URL that produced this record
        notes        TEXT                -- error / status notes from the resolver
        scraped_at   INTEGER NOT NULL    -- unix seconds
    )

Lookups:
    by source_url  → exact unique
    by name_key    → exact (possibly multiple rows; we return the freshest)

TTL is applied at read time. Expired rows are returned as None (caller will
re-resolve and upsert), but we don't auto-delete them so they remain available
for audit / inspection via the admin endpoint.

Concurrency:
    - sqlite3 is sync. All public functions are sync; async callers should
      wrap calls in `asyncio.to_thread` (helpers `aget_*` / `aupsert_*` do this).
    - One connection per call (cheap on SQLite, avoids cross-thread issues).
"""
from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Default TTL: 90 days. A company's website rarely changes faster than that.
DEFAULT_TTL_SECONDS = 90 * 24 * 3600


# ── Accent-folding mirror of career_finder._normalize ────────────────────────
# Kept here (vs. importing from career_finder) so this module has no circular
# dependency on the caller.

_ACCENT_MAP = str.maketrans(
    "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ"
    "ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ",
    "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd"
    "AAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD",
)


def normalize_name(s: str) -> str:
    """Lowercase + strip Vietnamese accents + collapse whitespace.
    Used as the lookup key for name-based queries."""
    folded = (s or "").translate(_ACCENT_MAP).lower()
    return " ".join(folded.split())


# ── Path / connection setup ──────────────────────────────────────────────────

def _db_path() -> Path:
    """Resolve the cache DB file path. Override with COMPANY_CACHE_DB env."""
    override = os.getenv("COMPANY_CACHE_DB")
    if override:
        return Path(override)
    # Default: backend/data/company_cache.db (relative to this file's grandparent)
    backend_root = Path(__file__).resolve().parent.parent.parent
    return backend_root / "data" / "company_cache.db"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    # WAL is friendlier for concurrent reads while a write is in flight.
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


_SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    name_key    TEXT,
    website_url TEXT,
    source      TEXT,
    source_url  TEXT UNIQUE,
    notes       TEXT,
    scraped_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_name_key ON companies(name_key);
CREATE INDEX IF NOT EXISTS idx_companies_website  ON companies(website_url);
"""

_initialized = False


def _ensure_schema(conn: sqlite3.Connection) -> None:
    global _initialized
    if _initialized:
        return
    conn.executescript(_SCHEMA)
    conn.commit()
    _initialized = True


# ── Public API ───────────────────────────────────────────────────────────────

@dataclass
class CachedCompany:
    id: int
    name: str
    name_key: str
    website_url: str
    source: str
    source_url: str
    notes: str
    scraped_at: int
    age_seconds: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def _row_to_cached(row: sqlite3.Row, now: Optional[int] = None) -> CachedCompany:
    now = now or int(time.time())
    return CachedCompany(
        id=row["id"],
        name=row["name"] or "",
        name_key=row["name_key"] or "",
        website_url=row["website_url"] or "",
        source=row["source"] or "",
        source_url=row["source_url"] or "",
        notes=row["notes"] or "",
        scraped_at=row["scraped_at"],
        age_seconds=now - row["scraped_at"],
    )


def get_by_source_url(url: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> Optional[CachedCompany]:
    """Look up by the original scrape URL. Returns None if missing or expired."""
    if not url:
        return None
    with _connect() as conn:
        _ensure_schema(conn)
        row = conn.execute(
            "SELECT * FROM companies WHERE source_url = ?", (url,)
        ).fetchone()
    if not row:
        return None
    cached = _row_to_cached(row)
    if cached.age_seconds > ttl_seconds:
        logger.info(f"[cache] expired for source_url={url} (age={cached.age_seconds}s)")
        return None
    return cached


def get_by_name(name: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> Optional[CachedCompany]:
    """Look up by company name (fuzzy: case + accent insensitive).
    Returns the freshest row that has a non-empty website_url."""
    if not name:
        return None
    key = normalize_name(name)
    if not key:
        return None
    with _connect() as conn:
        _ensure_schema(conn)
        row = conn.execute(
            """SELECT * FROM companies
               WHERE name_key = ? AND website_url != ''
               ORDER BY scraped_at DESC LIMIT 1""",
            (key,),
        ).fetchone()
    if not row:
        return None
    cached = _row_to_cached(row)
    if cached.age_seconds > ttl_seconds:
        logger.info(f"[cache] expired for name={name!r} (age={cached.age_seconds}s)")
        return None
    return cached


def upsert(
    name: str,
    website_url: str,
    source: str,
    source_url: str,
    notes: str = "",
) -> CachedCompany:
    """Insert or update by source_url. Returns the resulting row."""
    now = int(time.time())
    name_key = normalize_name(name)
    with _connect() as conn:
        _ensure_schema(conn)
        # Upsert keyed on source_url. If no source_url, we just insert.
        if source_url:
            conn.execute(
                """INSERT INTO companies (name, name_key, website_url, source, source_url, notes, scraped_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(source_url) DO UPDATE SET
                       name        = excluded.name,
                       name_key    = excluded.name_key,
                       website_url = excluded.website_url,
                       source      = excluded.source,
                       notes       = excluded.notes,
                       scraped_at  = excluded.scraped_at""",
                (name, name_key, website_url, source, source_url, notes, now),
            )
        else:
            conn.execute(
                """INSERT INTO companies (name, name_key, website_url, source, source_url, notes, scraped_at)
                   VALUES (?, ?, ?, ?, NULL, ?, ?)""",
                (name, name_key, website_url, source, notes, now),
            )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM companies WHERE source_url IS ? ORDER BY id DESC LIMIT 1",
            (source_url or None,),
        ).fetchone()
    return _row_to_cached(row)


def list_all(limit: int = 200, offset: int = 0) -> list[CachedCompany]:
    """List recent entries — for admin/debug endpoints."""
    with _connect() as conn:
        _ensure_schema(conn)
        rows = conn.execute(
            "SELECT * FROM companies ORDER BY scraped_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    now = int(time.time())
    return [_row_to_cached(r, now) for r in rows]


def delete(entry_id: int) -> bool:
    with _connect() as conn:
        _ensure_schema(conn)
        cur = conn.execute("DELETE FROM companies WHERE id = ?", (entry_id,))
        conn.commit()
        return cur.rowcount > 0


def clear_all() -> int:
    """Wipe the cache. Returns rows deleted."""
    with _connect() as conn:
        _ensure_schema(conn)
        cur = conn.execute("DELETE FROM companies")
        conn.commit()
        return cur.rowcount


def stats() -> dict:
    with _connect() as conn:
        _ensure_schema(conn)
        total = conn.execute("SELECT COUNT(*) AS n FROM companies").fetchone()["n"]
        with_site = conn.execute(
            "SELECT COUNT(*) AS n FROM companies WHERE website_url != ''"
        ).fetchone()["n"]
        oldest = conn.execute(
            "SELECT MIN(scraped_at) AS t FROM companies"
        ).fetchone()["t"]
    return {
        "total": total,
        "with_website": with_site,
        "oldest_scraped_at": oldest,
        "db_path": str(_db_path()),
    }


# ── Async wrappers — let FastAPI handlers `await` without blocking the loop ──

async def aget_by_source_url(url: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> Optional[CachedCompany]:
    return await asyncio.to_thread(get_by_source_url, url, ttl_seconds)


async def aget_by_name(name: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> Optional[CachedCompany]:
    return await asyncio.to_thread(get_by_name, name, ttl_seconds)


async def aupsert(name: str, website_url: str, source: str, source_url: str, notes: str = "") -> CachedCompany:
    return await asyncio.to_thread(upsert, name, website_url, source, source_url, notes)
