"""Repository for ``public.credits`` + ``public.credit_ledger`` — usage metering.

User-scoped. New users are lazily granted ``CREDIT_SIGNUP_GRANT`` (default 20)
on first touch — no GoTrue trigger needed. Spending is atomic: the balance is
decremented in a single guarded UPDATE so concurrent AI calls can't overspend.
"""
from __future__ import annotations

import os

from app.db.pool import get_pool

SIGNUP_GRANT = int(os.getenv("CREDIT_SIGNUP_GRANT", "50"))  # ~5 full tailor jobs


async def _ensure(conn, user_id: str) -> None:
    """Create the account with the signup grant if it doesn't exist yet."""
    row = await conn.fetchrow(
        "INSERT INTO credits (user_id, balance, granted_total) VALUES ($1, $2, $2) "
        "ON CONFLICT (user_id) DO NOTHING RETURNING balance",
        user_id, SIGNUP_GRANT,
    )
    if row is not None:  # freshly created → record the grant
        await conn.execute(
            "INSERT INTO credit_ledger (user_id, delta, reason, balance_after) "
            "VALUES ($1, $2, 'signup_grant', $2)",
            user_id, SIGNUP_GRANT,
        )


async def get_balance(user_id: str) -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _ensure(conn, user_id)
            return await conn.fetchval("SELECT balance FROM credits WHERE user_id = $1", user_id)


async def spend(user_id: str, action: str, cost: int) -> tuple[bool, int]:
    """Atomically debit ``cost`` credits. Returns (ok, balance_after_or_current).
    ok=False means insufficient balance (nothing was debited)."""
    if cost < 0:
        raise ValueError("cost must be >= 0")
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _ensure(conn, user_id)
            bal = await conn.fetchval(
                "UPDATE credits SET balance = balance - $2, spent_total = spent_total + $2, "
                "updated_at = now() WHERE user_id = $1 AND balance >= $2 RETURNING balance",
                user_id, cost,
            )
            if bal is None:  # insufficient — report current balance, debit nothing
                cur = await conn.fetchval("SELECT balance FROM credits WHERE user_id = $1", user_id)
                return False, cur
            await conn.execute(
                "INSERT INTO credit_ledger (user_id, delta, reason, action, balance_after) "
                "VALUES ($1, $2, 'spend', $3, $4)",
                user_id, -cost, action, bal,
            )
            return True, bal


async def grant(user_id: str, amount: int, reason: str = "topup") -> int:
    """Add credits (top-up / promo). Returns new balance."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _ensure(conn, user_id)
            bal = await conn.fetchval(
                "UPDATE credits SET balance = balance + $2, granted_total = granted_total + $2, "
                "updated_at = now() WHERE user_id = $1 RETURNING balance",
                user_id, amount,
            )
            await conn.execute(
                "INSERT INTO credit_ledger (user_id, delta, reason, balance_after) VALUES ($1, $2, $3, $4)",
                user_id, amount, reason, bal,
            )
    return bal
