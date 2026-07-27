"""Repository for ``public.ats_tenant_accounts`` + ``public.ats_auth_attempts``.

One row per (user, vendor, tenant) — where *tenant* is the canonical host, the
scope a candidate account actually lives in. ``account_state`` is the durable
verdict the batch runner reads BEFORE opening a tab, so the first job of a tenant
probes and every later job of that tenant inherits the answer instead of
re-authenticating (which is what trips lockouts).
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

STATES = (
    "unknown", "ready", "verification_required", "credential_required",
    "password_reset_required", "consent_required", "challenge_required",
    "temporarily_locked", "unsupported",
)

#: States the runner must not retry on its own — they need the user to do
#: something (check mail, supply a password, solve a challenge) first.
BLOCKING_STATES = (
    "verification_required", "credential_required", "password_reset_required",
    "consent_required", "challenge_required", "unsupported",
)

_COLS = (
    "id, user_id, ats_vendor, tenant_key, canonical_host, career_site_key, "
    "tenant_slug, credential_id, account_state, signup_via, last_error_code, "
    "last_error_source, last_auth_success_at, verification_requested_at, "
    "verification_expires_at, next_retry_at, created_at, updated_at"
)


async def get_or_create(
    *,
    user_id: str,
    ats_vendor: str,
    tenant_key: str,
    canonical_host: Optional[str] = None,
    career_site_key: Optional[str] = None,
    tenant_slug: Optional[str] = None,
) -> dict:
    """Fetch the tenant row, creating it in ``unknown`` if this is first contact.

    Called on the JIT credential fetch so a subsequent auth-result always has a
    row to attach to. ``career_site_key``/``tenant_slug`` refresh on every call
    (metadata, cheap to keep current); ``account_state`` is never reset here.
    """
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"""
            INSERT INTO ats_tenant_accounts
                (user_id, ats_vendor, tenant_key, canonical_host, career_site_key, tenant_slug)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id, ats_vendor, tenant_key) DO UPDATE
                SET career_site_key = COALESCE(EXCLUDED.career_site_key,
                                               ats_tenant_accounts.career_site_key),
                    tenant_slug     = COALESCE(EXCLUDED.tenant_slug,
                                               ats_tenant_accounts.tenant_slug)
            RETURNING {_COLS}
            """,
            user_id, ats_vendor, tenant_key, canonical_host or tenant_key,
            career_site_key, tenant_slug,
        )
    )


async def get(user_id: str, ats_vendor: str, tenant_key: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"SELECT {_COLS} FROM ats_tenant_accounts "
            f"WHERE user_id = $1 AND ats_vendor = $2 AND tenant_key = $3",
            user_id, ats_vendor, tenant_key,
        )
    )


async def list_for_user(user_id: str, ats_vendor: Optional[str] = None) -> list[dict]:
    pool = await get_pool()
    if ats_vendor:
        rows = await pool.fetch(
            f"SELECT {_COLS} FROM ats_tenant_accounts "
            f"WHERE user_id = $1 AND ats_vendor = $2 ORDER BY updated_at DESC",
            user_id, ats_vendor,
        )
    else:
        rows = await pool.fetch(
            f"SELECT {_COLS} FROM ats_tenant_accounts "
            f"WHERE user_id = $1 ORDER BY updated_at DESC",
            user_id,
        )
    return rows_to_dicts(rows)


async def set_state(
    *,
    user_id: str,
    ats_vendor: str,
    tenant_key: str,
    account_state: str,
    signup_via: Optional[str] = None,
    last_error_code: Optional[str] = None,
    last_error_source: Optional[str] = None,
    verification_requested: bool = False,
    next_retry_at=None,
) -> Optional[dict]:
    """Record the verdict of an auth operation.

    ``last_auth_success_at`` stamps only on ``ready``. ``verification_requested_at``
    is set when the signup first asks for email verification and left alone on
    later touches, so "how long has this been waiting?" stays answerable.
    ``verification_expires_at`` is deliberately NOT set: Workday publishes no TTL,
    so the UI treats age as a hint rather than hard-expiring a link that may work.
    """
    if account_state not in STATES:
        raise ValueError(f"invalid account_state {account_state!r}; expected one of {STATES}")
    pool = await get_pool()
    sql = f"""
        UPDATE ats_tenant_accounts
        SET account_state = $4,
            signup_via = COALESCE($5, signup_via),
            last_error_code = $6,
            last_error_source = $7,
            last_auth_success_at = CASE WHEN $4 = 'ready' THEN now() ELSE last_auth_success_at END,
            verification_requested_at = CASE
                WHEN $8 AND verification_requested_at IS NULL THEN now()
                ELSE verification_requested_at END,
            next_retry_at = $9
        WHERE user_id = $1 AND ats_vendor = $2 AND tenant_key = $3
        RETURNING {_COLS}
    """
    return row_to_dict(
        await pool.fetchrow(
            sql, user_id, ats_vendor, tenant_key, account_state, signup_via,
            last_error_code, last_error_source, verification_requested, next_retry_at,
        )
    )


async def set_next_retry(
    *, user_id: str, ats_vendor: str, tenant_key: str, seconds: int
) -> Optional[dict]:
    """Stamp a backoff deadline the runner honours before touching this tenant
    again. Rate-limit / lockout responses carry one; without it the runner would
    keep re-probing a tenant that is actively refusing us."""
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"""
            UPDATE ats_tenant_accounts
            SET next_retry_at = now() + ($4 || ' seconds')::interval
            WHERE user_id = $1 AND ats_vendor = $2 AND tenant_key = $3
            RETURNING {_COLS}
            """,
            user_id, ats_vendor, tenant_key, str(int(seconds)),
        )
    )


async def pin_credential(
    *, user_id: str, ats_vendor: str, tenant_key: str, credential_id: str
) -> Optional[dict]:
    """Bind the tenant to the credential that actually created/opened its account.
    This pin is what makes a later default-password change harmless."""
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"""
            UPDATE ats_tenant_accounts SET credential_id = $4
            WHERE user_id = $1 AND ats_vendor = $2 AND tenant_key = $3
            RETURNING {_COLS}
            """,
            user_id, ats_vendor, tenant_key, credential_id,
        )
    )


async def clear_block(
    *, user_id: str, ats_vendor: str, tenant_key: str
) -> Optional[dict]:
    """User says they've done their part (verified the mail / supplied a new
    password): drop back to ``unknown`` so the next batch re-probes exactly once.
    Not a login itself — the runner does that on its own schedule."""
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"""
            UPDATE ats_tenant_accounts
            SET account_state = 'unknown', last_error_code = NULL,
                last_error_source = NULL, next_retry_at = NULL
            WHERE user_id = $1 AND ats_vendor = $2 AND tenant_key = $3
            RETURNING {_COLS}
            """,
            user_id, ats_vendor, tenant_key,
        )
    )


async def record_attempt(
    *,
    user_id: str,
    tenant_account_id: str,
    operation: str,
    outcome: str,
    source: str,
    source_code: Optional[str] = None,
    consent_accepted: Optional[list] = None,
    retryable: bool = False,
    batch_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    automation_version: Optional[str] = None,
) -> Optional[dict]:
    """Append to the audit log. Only normalized fields land here — never the
    password, the request body, cookies, or a raw ATS response. ``consent_accepted``
    carries the sanitized labels of any consent the agent ticked on the user's
    behalf, which is the evidence for that delegation.

    Returns None when ``idempotency_key`` collides — the extension retried a
    network call that had in fact landed, and the attempt is already recorded.
    """
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            """
            INSERT INTO ats_auth_attempts
                (user_id, tenant_account_id, batch_id, idempotency_key, operation,
                 outcome, source, source_code, consent_accepted, retryable,
                 automation_version, completed_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
            ON CONFLICT DO NOTHING
            RETURNING id, tenant_account_id, operation, outcome, source, started_at
            """,
            user_id, tenant_account_id, batch_id, idempotency_key, operation,
            outcome, source, source_code, consent_accepted, retryable,
            automation_version,
        )
    )
