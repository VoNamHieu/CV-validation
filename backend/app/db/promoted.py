"""Repository for ``public.promoted_jobs`` — self-hosted job landing pages.

An admin publishes a job from the store; we freeze a SNAPSHOT of it (title /
company / location / JD) and mint a public ``slug``. The public page renders
from the snapshot forever — decoupled from the live ``jobs`` row, which may go
dead. ``job_id`` is a soft reference (no FK) so deleting a job never breaks a
published link.

The snapshot carries an internal ``source_url`` (used by the apply flow) that
MUST NOT reach the public read endpoint — use ``public_view()`` to serialize
for anonymous callers.
"""
from __future__ import annotations

import re
import unicodedata
import uuid
from typing import Optional

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

_COLS = (
    "id, slug, job_id, snapshot, status, template, og_image_url, "
    "view_count, created_by, created_at, updated_at"
)

# Snapshot keys safe to expose publicly. Everything else (e.g. source_url) is
# internal and stripped by public_view().
_PUBLIC_SNAPSHOT_KEYS = (
    "title", "company_name", "location", "description",
    "industry", "role_family", "seniority",
)


def _slugify(text: str) -> str:
    """ASCII, lowercase, hyphenated slug fragment from Vietnamese text."""
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "d").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:60] or "job"


_MAX_SNAPSHOT_DESC = 12000  # keep the snapshot JSON reasonable


def build_snapshot(job: dict, company_name: Optional[str] = None) -> dict:
    """Freeze the display + apply fields off a live ``jobs`` (joined) row."""
    return {
        "title": job.get("title") or "",
        "company_name": company_name or job.get("company_name") or "",
        "location": job.get("location") or "",
        "description": (job.get("description") or "")[:_MAX_SNAPSHOT_DESC],
        "industry": job.get("industry") or "",
        "role_family": job.get("role_family") or "",
        "seniority": job.get("seniority") or "",
        # Internal — used by the apply flow, never shown publicly.
        "source_url": job.get("source_url") or "",
    }


def public_view(row: dict) -> dict:
    """Serialize a row for the ANONYMOUS public page — strips internal snapshot
    fields (source_url) and operator metadata."""
    snap = row.get("snapshot") or {}
    return {
        "slug": row.get("slug"),
        "template": row.get("template") or "default",
        "og_image_url": row.get("og_image_url"),
        "job": {k: snap.get(k, "") for k in _PUBLIC_SNAPSHOT_KEYS},
    }


async def create(
    *,
    slug: str,
    snapshot: dict,
    job_id: Optional[str] = None,
    status: str = "published",
    template: str = "default",
    og_image_url: Optional[str] = None,
    created_by: Optional[str] = None,
) -> dict:
    pool = await get_pool()
    sql = f"""
        INSERT INTO promoted_jobs
            (slug, job_id, snapshot, status, template, og_image_url, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING {_COLS}
    """
    return row_to_dict(await pool.fetchrow(
        sql, slug, job_id, snapshot, status, template, og_image_url, created_by,
    ))


async def unique_slug(base: str) -> str:
    """A collision-free slug: ``<base>`` if free, else ``<base>-<6hex>``."""
    pool = await get_pool()
    base = _slugify(base)
    taken = await pool.fetchval("SELECT 1 FROM promoted_jobs WHERE slug = $1", base)
    if not taken:
        return base
    return f"{base}-{uuid.uuid4().hex[:6]}"


async def get_by_slug(slug: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(await pool.fetchrow(
        f"SELECT {_COLS} FROM promoted_jobs WHERE slug = $1", slug,
    ))


async def get(page_id: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(await pool.fetchrow(
        f"SELECT {_COLS} FROM promoted_jobs WHERE id = $1", page_id,
    ))


async def get_by_job(job_id: str) -> Optional[dict]:
    """The existing page for a job, if already published (re-publish idempotency)."""
    pool = await get_pool()
    return row_to_dict(await pool.fetchrow(
        f"SELECT {_COLS} FROM promoted_jobs WHERE job_id = $1 "
        f"ORDER BY created_at DESC LIMIT 1", job_id,
    ))


async def list_pages(*, limit: int = 100, offset: int = 0) -> list[dict]:
    pool = await get_pool()
    return rows_to_dicts(await pool.fetch(
        f"SELECT {_COLS} FROM promoted_jobs "
        f"ORDER BY created_at DESC LIMIT $1 OFFSET $2", limit, offset,
    ))


async def update(page_id: str, **fields) -> Optional[dict]:
    """Patch mutable columns (slug, snapshot, status, template, og_image_url)."""
    allowed = {"slug", "snapshot", "status", "template", "og_image_url"}
    sets, args = [], []
    for k, v in fields.items():
        if k in allowed and v is not None:
            args.append(v)
            sets.append(f"{k} = ${len(args)}")
    if not sets:
        return await get(page_id)
    args.append(page_id)
    pool = await get_pool()
    sql = (f"UPDATE promoted_jobs SET {', '.join(sets)}, updated_at = now() "
           f"WHERE id = ${len(args)} RETURNING {_COLS}")
    return row_to_dict(await pool.fetchrow(sql, *args))


async def delete(page_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute("DELETE FROM promoted_jobs WHERE id = $1", page_id)
    return result.endswith("1")


async def increment_view(slug: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "UPDATE promoted_jobs SET view_count = view_count + 1 WHERE slug = $1", slug,
    )


async def delete_dead() -> list[str]:
    """Delete promoted pages whose backing job is now inactive (posting closed).

    Only touches pages with a ``job_id`` that JOINs an ``is_active = false`` job —
    manual pages (job_id NULL) and pages whose job still lives are left alone.
    Returns the deleted slugs (for the cron log). This is the auto-cleanup the
    periodic refresh calls after re-ingesting the store."""
    pool = await get_pool()
    rows = await pool.fetch(
        "DELETE FROM promoted_jobs p USING jobs j "
        "WHERE p.job_id = j.id AND j.is_active = false "
        "RETURNING p.slug"
    )
    return [r["slug"] for r in rows]
