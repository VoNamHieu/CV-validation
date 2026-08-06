"""Repository for ``public.ats_credentials`` + ``public.ats_default_credentials``.

APPEND-ONLY by design: there is deliberately no ``update_password`` — a password
already used to create a candidate account at some tenant must keep working
there, so changing the default INSERTS a new row and retires the old one while
tenants stay pinned to whichever credential actually created their account.

``_COLS`` omits ``password_encrypted`` so ordinary reads cannot leak ciphertext;
the sealed blob is only reachable through :func:`get_secret`.
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

LIFECYCLE = ("active", "retired", "revoked")

_COLS = (
    "id, user_id, ats_vendor, credential_type, email, encryption_key_version, "
    "lifecycle_state, replaced_by_id, created_at, retired_at, revoked_at"
)


async def create_default(
    *,
    user_id: str,
    ats_vendor: str,
    email: str,
    password_encrypted: bytes,
    key_version: str,
) -> dict:
    """Set (or replace) the user's default credential for a vendor.

    One transaction: insert the new row → retire the outgoing default (pointing
    ``replaced_by_id`` at the newcomer so the chain is walkable) → move the
    pointer. Tenant rows are intentionally NOT touched: a tenant whose account
    was created with the old password keeps pinning it and keeps logging in.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            new = await conn.fetchrow(
                f"""
                INSERT INTO ats_credentials
                    (user_id, ats_vendor, credential_type, email,
                     password_encrypted, encryption_key_version)
                VALUES ($1, $2, 'default', $3, $4, $5)
                RETURNING {_COLS}
                """,
                user_id, ats_vendor, email, password_encrypted, key_version,
            )
            prev = await conn.fetchval(
                "SELECT credential_id FROM ats_default_credentials "
                "WHERE user_id = $1 AND ats_vendor = $2",
                user_id, ats_vendor,
            )
            if prev and str(prev) != str(new["id"]):
                await conn.execute(
                    "UPDATE ats_credentials "
                    "SET lifecycle_state = 'retired', retired_at = now(), replaced_by_id = $2 "
                    "WHERE id = $1 AND lifecycle_state = 'active'",
                    prev, new["id"],
                )
            await conn.execute(
                """
                INSERT INTO ats_default_credentials (user_id, ats_vendor, credential_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (user_id, ats_vendor)
                DO UPDATE SET credential_id = EXCLUDED.credential_id, updated_at = now()
                """,
                user_id, ats_vendor, new["id"],
            )
    return row_to_dict(new)


async def get_default(user_id: str, ats_vendor: str) -> Optional[dict]:
    """The credential the pointer currently designates — whatever its lifecycle.

    Callers decide what a non-``active`` state means; ``has_active_default`` is
    the question the batch-start check actually asks.
    """
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"""
            SELECT {_COLS} FROM ats_credentials c
            JOIN ats_default_credentials d ON d.credential_id = c.id
            WHERE d.user_id = $1 AND d.ats_vendor = $2
            """,
            user_id, ats_vendor,
        )
    )


async def has_active_default(user_id: str, ats_vendor: str) -> bool:
    """Drives whether the batch-start modal appears. A revoked default counts as
    NO default — otherwise revoking would strand the user with no way to supply a
    replacement and every tenant stuck at ``credential_required``."""
    row = await get_default(user_id, ats_vendor)
    return bool(row and row["lifecycle_state"] == "active")


async def create_tenant_override(
    *,
    user_id: str,
    ats_vendor: str,
    email: str,
    password_encrypted: bytes,
    key_version: str,
) -> dict:
    """A credential for ONE tenant whose existing account uses different details.
    Both email and password are per-override: a pre-existing candidate account may
    well sit under an old/work address, in which case the password alone is no fix.
    Pinning it to the tenant is :func:`ats_tenant_accounts.pin_credential`."""
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"""
            INSERT INTO ats_credentials
                (user_id, ats_vendor, credential_type, email,
                 password_encrypted, encryption_key_version)
            VALUES ($1, $2, 'tenant_override', $3, $4, $5)
            RETURNING {_COLS}
            """,
            user_id, ats_vendor, email, password_encrypted, key_version,
        )
    )


async def get_secret(credential_id: str, user_id: str) -> Optional[dict]:
    """Fetch the sealed blob for decryption. The ONLY read path that returns
    ciphertext — keep its callers countable (JIT apply fetch + override dedupe)."""
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            "SELECT id, email, password_encrypted, encryption_key_version, "
            "       lifecycle_state, credential_type "
            "FROM ats_credentials WHERE id = $1 AND user_id = $2",
            credential_id, user_id,
        )
    )


async def list_for_user(user_id: str, ats_vendor: str) -> list[dict]:
    pool = await get_pool()
    return rows_to_dicts(
        await pool.fetch(
            f"SELECT {_COLS} FROM ats_credentials "
            f"WHERE user_id = $1 AND ats_vendor = $2 ORDER BY created_at DESC",
            user_id, ats_vendor,
        )
    )


async def revoke(credential_id: str, user_id: str) -> Optional[dict]:
    """Kill a credential outright (compromise). Unlike ``retired``, this wins over
    an existing pin: every tenant still pointing at it is forced to
    ``credential_required`` so the user is asked for something new rather than
    being made to keep using a leaked secret."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                f"""
                UPDATE ats_credentials
                SET lifecycle_state = 'revoked', revoked_at = now()
                WHERE id = $1 AND user_id = $2 AND lifecycle_state <> 'revoked'
                RETURNING {_COLS}
                """,
                credential_id, user_id,
            )
            if row is not None:
                await conn.execute(
                    "UPDATE ats_tenant_accounts "
                    "SET account_state = 'credential_required', "
                    "    last_error_code = 'credential_revoked', last_error_source = 'server' "
                    "WHERE user_id = $1 AND credential_id = $2",
                    user_id, credential_id,
                )
    return row_to_dict(row)
