"""Repository for ``public.credits`` + ``public.credit_ledger`` — usage metering.

User-scoped. New users are lazily granted ``CREDIT_SIGNUP_GRANT`` (default 50)
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
        # Hot, client-polled endpoint — READ FIRST. A plain SELECT is MVCC (no
        # lock), so an existing user's balance check never waits on the credits
        # row's lock. The old path always ran _ensure's INSERT-ON-CONFLICT, which
        # blocks on that lock when a concurrent spend/grant holds it → statement
        # timeout. Lazily create (the signup grant) only when the row is missing.
        bal = await conn.fetchval("SELECT balance FROM credits WHERE user_id = $1", user_id)
        if bal is not None:
            return bal
        async with conn.transaction():
            await _ensure(conn, user_id)
            return await conn.fetchval("SELECT balance FROM credits WHERE user_id = $1", user_id)


async def spend(user_id: str, action: str, cost: int,
                request_id: str | None = None) -> tuple[bool, int]:
    """Atomically debit ``cost`` credits. Returns (ok, balance_after_or_current).
    ok=False means insufficient balance (nothing was debited).

    ``request_id`` makes the debit IDEMPOTENT: replaying the same
    (user, request_id) — a client/proxy retry after a timeout — returns ok=True
    without debiting again. The credits row is locked FOR UPDATE so the
    replay-check + debit + ledger insert are serial per user; the partial
    unique index on (user_id, reason, request_id) is the invariant backstop.
    A REJECTED spend writes no ledger row, so the same request_id may be
    retried after a top-up and will then debit normally."""
    if cost < 0:
        raise ValueError("cost must be >= 0")
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _ensure(conn, user_id)
            cur = await conn.fetchval(
                "SELECT balance FROM credits WHERE user_id = $1 FOR UPDATE", user_id)
            if request_id:
                prior = await conn.fetchval(
                    "SELECT 1 FROM credit_ledger "
                    "WHERE user_id = $1 AND request_id = $2 AND reason = 'spend'",
                    user_id, request_id,
                )
                if prior:  # replay — already charged, report current balance
                    return True, cur
            bal = await conn.fetchval(
                "UPDATE credits SET balance = balance - $2, spent_total = spent_total + $2, "
                "updated_at = now() WHERE user_id = $1 AND balance >= $2 RETURNING balance",
                user_id, cost,
            )
            if bal is None:  # insufficient — report current balance, debit nothing
                return False, cur
            await conn.execute(
                "INSERT INTO credit_ledger (user_id, delta, reason, action, balance_after, request_id) "
                "VALUES ($1, $2, 'spend', $3, $4, $5)",
                user_id, -cost, action, bal, request_id,
            )
            return True, bal


async def refund(user_id: str, request_id: str) -> dict:
    """Reverse a spend identified by ``request_id``. Server-initiated only
    (the route gates on an internal key) — called when the AI work FAILED
    after a successful debit, so the user isn't charged for nothing.

    Idempotent: refunding twice returns already_refunded and changes nothing
    (FOR UPDATE serializes; the unique index forbids a second 'refund' row).
    Unknown request_id → spend_not_found, nothing granted. spent_total is
    decremented (a refund reverses a spend; granted_total stays money-in)."""
    if not request_id:
        return {"refunded": 0, "balance": None, "status": "spend_not_found"}
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _ensure(conn, user_id)
            cur = await conn.fetchval(
                "SELECT balance FROM credits WHERE user_id = $1 FOR UPDATE", user_id)
            spent = await conn.fetchrow(
                "SELECT delta, action FROM credit_ledger "
                "WHERE user_id = $1 AND request_id = $2 AND reason = 'spend'",
                user_id, request_id,
            )
            if spent is None:
                return {"refunded": 0, "balance": cur, "status": "spend_not_found"}
            already = await conn.fetchval(
                "SELECT 1 FROM credit_ledger "
                "WHERE user_id = $1 AND request_id = $2 AND reason = 'refund'",
                user_id, request_id,
            )
            if already:
                return {"refunded": 0, "balance": cur, "status": "already_refunded"}
            amount = -spent["delta"]  # spend delta is negative
            bal = await conn.fetchval(
                "UPDATE credits SET balance = balance + $2, "
                "spent_total = GREATEST(spent_total - $2, 0), updated_at = now() "
                "WHERE user_id = $1 RETURNING balance",
                user_id, amount,
            )
            await conn.execute(
                "INSERT INTO credit_ledger (user_id, delta, reason, action, balance_after, request_id) "
                "VALUES ($1, $2, 'refund', $3, $4, $5)",
                user_id, amount, spent["action"], bal, request_id,
            )
            return {"refunded": amount, "balance": bal, "status": "refunded"}


FREE_TOPUP_AMOUNT = int(os.getenv("CREDIT_FREE_TOPUP", "50"))


async def request_topup(user_id: str, amount: int = FREE_TOPUP_AMOUNT) -> dict:
    """One-time free top-up. The first request grants `amount` credits; any
    request after that requires payment (returns requires_payment=True so the
    UI shows bank-transfer details). Locks the user's credits row so concurrent
    requests can't double-grant."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _ensure(conn, user_id)
            # Serialize per-user so the EXISTS check + grant are atomic.
            await conn.fetchval("SELECT balance FROM credits WHERE user_id = $1 FOR UPDATE", user_id)
            used = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM credit_ledger WHERE user_id = $1 AND reason = 'free_topup')",
                user_id,
            )
            if used:
                bal = await conn.fetchval("SELECT balance FROM credits WHERE user_id = $1", user_id)
                return {"granted": 0, "balance": bal, "requires_payment": True}
            bal = await conn.fetchval(
                "UPDATE credits SET balance = balance + $2, granted_total = granted_total + $2, "
                "updated_at = now() WHERE user_id = $1 RETURNING balance",
                user_id, amount,
            )
            await conn.execute(
                "INSERT INTO credit_ledger (user_id, delta, reason, balance_after) "
                "VALUES ($1, $2, 'free_topup', $3)",
                user_id, amount, bal,
            )
            return {"granted": amount, "balance": bal, "requires_payment": False}


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
