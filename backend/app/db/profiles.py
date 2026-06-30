"""Repository for ``public.profiles`` — a thin mirror of ``auth.users``.

``id`` is a FK to ``auth.users(id)``, so a profile can only exist for a real
Supabase auth user. Created/refreshed on first sign-in (or by a Supabase
trigger); we expose upsert for the backend-managed path.
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict

_COLS = "id, email, created_at, terms_accepted_at, terms_version, agent_consent_at"


async def upsert(*, user_id: str, email: Optional[str] = None) -> dict:
    pool = await get_pool()
    sql = f"""
        INSERT INTO profiles (id, email) VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET email = COALESCE(EXCLUDED.email, profiles.email)
        RETURNING {_COLS}
    """
    return row_to_dict(await pool.fetchrow(sql, user_id, email))


async def get(user_id: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(f"SELECT {_COLS} FROM profiles WHERE id = $1", user_id)
    )


async def accept_terms(*, user_id: str, version: str) -> dict:
    """Record acceptance of the Terms + Privacy at signup (the mandatory
    checkbox). Stamps the current time and the accepted version. Creates the
    profile row if it doesn't exist yet (e.g. first action before sign-in
    upsert). Re-accepting updates to the latest version + time."""
    pool = await get_pool()
    sql = f"""
        INSERT INTO profiles (id, terms_accepted_at, terms_version)
        VALUES ($1, now(), $2)
        ON CONFLICT (id) DO UPDATE
            SET terms_accepted_at = now(), terms_version = EXCLUDED.terms_version
        RETURNING {_COLS}
    """
    return row_to_dict(await pool.fetchrow(sql, user_id, version))


async def set_agent_consent(*, user_id: str) -> dict:
    """Record the separate, just-in-time consent for the auto-apply agent.
    Preserves the FIRST consent timestamp (COALESCE) so the evidence reflects
    when the user was actually warned, not the latest re-trigger."""
    pool = await get_pool()
    sql = f"""
        INSERT INTO profiles (id, agent_consent_at)
        VALUES ($1, now())
        ON CONFLICT (id) DO UPDATE
            SET agent_consent_at = COALESCE(profiles.agent_consent_at, now())
        RETURNING {_COLS}
    """
    return row_to_dict(await pool.fetchrow(sql, user_id))


async def delete_account(user_id: str) -> None:
    """Hard-delete the user and ALL their data (Privacy §5 — right to erasure).
    One transaction: app rows first, then the profile, then the auth.users row
    (which also cascades auth identities/sessions). Explicit per-table deletes
    so cleanup doesn't depend on every FK being ON DELETE CASCADE."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for table in ("applications", "saved_jobs", "cv_profiles",
                          "credit_ledger", "credits"):
                await conn.execute(f"DELETE FROM {table} WHERE user_id = $1", user_id)
            await conn.execute("DELETE FROM profiles WHERE id = $1", user_id)
            await conn.execute("DELETE FROM auth.users WHERE id = $1", user_id)


async def find_id_by_email(email: str) -> Optional[str]:
    """Resolve a user id from their email (case-insensitive). Used by admin
    tooling to target a user without knowing their UUID."""
    pool = await get_pool()
    return await pool.fetchval(
        "SELECT id FROM profiles WHERE lower(email) = lower($1)", email
    )
