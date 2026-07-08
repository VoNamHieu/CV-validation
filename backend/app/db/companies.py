"""Repository for ``public.companies`` — the employer universe.

A company is keyed by ``domain`` (unique). Crawlers upsert by domain so a
repeat sweep refreshes the row instead of duplicating it.
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

# No vector column on companies — safe to select *. The raw logo bytes
# (logo_b64) are deliberately NOT listed: they'd bloat every list/get. We expose
# only a cheap ``has_logo`` boolean so the admin UI can show which companies
# already have a brand image without shipping the base64.
_COLS = (
    "id, name, domain, industry, career_url, ats_type, in_universe, "
    "segment, demand_score, last_swept_at, created_at, "
    "(logo_b64 IS NOT NULL) AS has_logo"
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
    *, in_universe: Optional[bool] = None, q: Optional[str] = None,
    limit: int = 100, offset: int = 0,
) -> list[dict]:
    """List companies (newest-demand first). ``q`` filters by name/domain
    (case-insensitive substring) for the admin logo picker; ``in_universe``
    narrows to the featured universe. Logo bytes are never included — see
    ``_COLS``' ``has_logo`` flag."""
    where, args = [], []
    if in_universe is not None:
        args.append(in_universe)
        where.append(f"in_universe = ${len(args)}")
    if q:
        args.append(f"%{q.strip()}%")
        where.append(f"(name ILIKE ${len(args)} OR domain ILIKE ${len(args)})")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    args.extend([limit, offset])
    sql = (f"SELECT {_COLS} FROM companies {clause} "
           f"ORDER BY demand_score DESC, name ASC LIMIT ${len(args)-1} OFFSET ${len(args)}")
    pool = await get_pool()
    return rows_to_dicts(await pool.fetch(sql, *args))


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


async def get_logo_by_domain(domain: str) -> Optional[dict]:
    """Return ``{logo_b64, logo_mime}`` for a company by its domain, or None.
    Powers the domain-keyed logo endpoint so surfaces that only know a company's
    domain (the landing marquee, featured-jobs groups) can render the uploaded
    brand instead of a Clearbit guess / letter. ``www.`` is stripped to match how
    domains are stored (see job_ingest._domain)."""
    d = (domain or "").strip().lower()
    d = d[4:] if d.startswith("www.") else d
    if not d:
        return None
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            "SELECT logo_b64, logo_mime FROM companies "
            "WHERE domain = $1 AND logo_b64 IS NOT NULL LIMIT 1", d,
        )
    )


async def clear_logo(company_id: str) -> bool:
    """Drop a company's stored logo (admin removed it). Returns whether a row
    was updated."""
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE companies SET logo_b64 = NULL, logo_mime = NULL WHERE id = $1",
        company_id,
    )
    return result.endswith("1")
