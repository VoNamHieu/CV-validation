"""Repository for ``public.companies`` — the employer universe.

A company is keyed by ``domain`` (unique). Crawlers upsert by domain so a
repeat sweep refreshes the row instead of duplicating it.
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

# No vector column on companies — safe to select *.
_COLS = (
    "id, name, domain, industry, career_url, ats_type, in_universe, "
    "segment, demand_score, last_swept_at, created_at"
)


async def upsert(
    *,
    name: str,
    domain: Optional[str] = None,
    industry: Optional[str] = None,
    career_url: Optional[str] = None,
    ats_type: Optional[str] = None,
    in_universe: bool = False,
    segment: Optional[str] = None,
    demand_score: int = 0,
) -> dict:
    """Insert a company, or update it in place when ``domain`` already exists.

    Domain is the conflict key. With no domain we cannot dedupe, so we plain
    insert (callers should pass a domain whenever they have one)."""
    pool = await get_pool()
    if domain:
        sql = f"""
            INSERT INTO companies
                (name, domain, industry, career_url, ats_type, in_universe, segment, demand_score)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (domain) DO UPDATE SET
                name         = EXCLUDED.name,
                industry     = COALESCE(EXCLUDED.industry, companies.industry),
                career_url   = COALESCE(EXCLUDED.career_url, companies.career_url),
                ats_type     = COALESCE(EXCLUDED.ats_type, companies.ats_type),
                in_universe  = EXCLUDED.in_universe OR companies.in_universe,
                segment      = COALESCE(EXCLUDED.segment, companies.segment),
                demand_score = GREATEST(EXCLUDED.demand_score, companies.demand_score)
            RETURNING {_COLS}
        """
        args = (name, domain, industry, career_url, ats_type, in_universe, segment, demand_score)
    else:
        sql = f"""
            INSERT INTO companies
                (name, industry, career_url, ats_type, in_universe, segment, demand_score)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING {_COLS}
        """
        args = (name, industry, career_url, ats_type, in_universe, segment, demand_score)
    return row_to_dict(await pool.fetchrow(sql, *args))


async def get(company_id: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(f"SELECT {_COLS} FROM companies WHERE id = $1", company_id)
    )


async def get_by_domain(domain: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(f"SELECT {_COLS} FROM companies WHERE domain = $1", domain)
    )


async def list_companies(
    *, in_universe: Optional[bool] = None, limit: int = 100, offset: int = 0
) -> list[dict]:
    pool = await get_pool()
    if in_universe is None:
        sql = f"SELECT {_COLS} FROM companies ORDER BY demand_score DESC LIMIT $1 OFFSET $2"
        rows = await pool.fetch(sql, limit, offset)
    else:
        sql = (
            f"SELECT {_COLS} FROM companies WHERE in_universe = $1 "
            f"ORDER BY demand_score DESC LIMIT $2 OFFSET $3"
        )
        rows = await pool.fetch(sql, in_universe, limit, offset)
    return rows_to_dicts(rows)


async def touch_swept(company_id: str) -> None:
    """Stamp ``last_swept_at = now()`` after a crawl pass."""
    pool = await get_pool()
    await pool.execute(
        "UPDATE companies SET last_swept_at = now() WHERE id = $1", company_id
    )


# ── Logo (deliberately excluded from _COLS so listings don't drag the bytes) ──

async def set_logo(company_id: str, *, logo_b64: str, logo_mime: Optional[str] = None) -> None:
    """Store an uploaded logo (base64) as the company's source logo. Overwrite —
    the latest deliberate upload wins. Mirrored here from a promoted page so the
    brand image is reused everywhere instead of the Clearbit-from-domain guess."""
    pool = await get_pool()
    await pool.execute(
        "UPDATE companies SET logo_b64 = $2, logo_mime = $3 WHERE id = $1",
        company_id, logo_b64, logo_mime or "image/png",
    )


async def get_logo(company_id: str) -> Optional[dict]:
    """Return ``{logo_b64, logo_mime}`` for a company, or None. Read via the
    dedicated logo endpoint / promoted-seed path only — never in list views."""
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            "SELECT logo_b64, logo_mime FROM companies WHERE id = $1", company_id
        )
    )
