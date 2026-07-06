"""Credits repo — idempotent spend + refund, verified against a REAL Postgres.

These tests need a local Postgres (they exercise the FOR UPDATE serialization
and the partial unique index, which mocks can't prove). They connect to
``CREDITS_TEST_DSN`` (default postgresql://claude:claude@localhost/jobfit_test)
and SKIP cleanly when no server is reachable, so the suite stays green in
environments without one. Setup is idempotent: a stub ``auth.users``, then
migrations 001 + 008 verbatim.
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import uuid

import pytest

from app.db import credits as credits_repo

_DSN = os.getenv("CREDITS_TEST_DSN", "postgresql://claude:claude@localhost/jobfit_test")
_MIGRATIONS = pathlib.Path(__file__).resolve().parents[1] / "migrations"

_SETUP = """
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
-- Supabase built-ins the migrations reference, stubbed for vanilla Postgres:
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    AS $$ SELECT NULL::uuid $$ LANGUAGE sql;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
"""


@pytest.fixture
async def db(monkeypatch):
    """A pool on the test DB, wired into the repo. Yields (pool, user_id)."""
    asyncpg = pytest.importorskip("asyncpg")
    try:
        pool = await asyncpg.create_pool(_DSN, min_size=1, max_size=5, timeout=3)
    except Exception:
        pytest.skip("no local Postgres for credits tests (set CREDITS_TEST_DSN)")
    async with pool.acquire() as conn:
        await conn.execute(_SETUP)
        for mig in ("001_credits.sql", "008_credit_refunds.sql"):
            await conn.execute((_MIGRATIONS / mig).read_text())
    user_id = str(uuid.uuid4())
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO auth.users (id) VALUES ($1)", user_id)

    async def _pool():
        return pool

    monkeypatch.setattr(credits_repo, "get_pool", _pool)
    yield pool, user_id
    await pool.close()


async def _spend_rows(pool, user_id, request_id, reason="spend"):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT count(*) FROM credit_ledger "
            "WHERE user_id=$1 AND request_id=$2 AND reason=$3",
            user_id, request_id, reason)


async def test_spend_replay_debits_once(db):
    pool, uid = db
    rid = str(uuid.uuid4())
    ok1, bal1 = await credits_repo.spend(uid, "score", 4, request_id=rid)
    ok2, bal2 = await credits_repo.spend(uid, "score", 4, request_id=rid)
    assert (ok1, ok2) == (True, True)
    assert bal1 == credits_repo.SIGNUP_GRANT - 4
    assert bal2 == bal1                     # replay: no second debit
    assert await _spend_rows(pool, uid, rid) == 1


async def test_concurrent_same_request_debits_once(db):
    pool, uid = db
    rid = str(uuid.uuid4())
    results = await asyncio.gather(
        *(credits_repo.spend(uid, "optimize", 5, request_id=rid) for _ in range(5)))
    assert all(ok for ok, _ in results)
    assert await credits_repo.get_balance(uid) == credits_repo.SIGNUP_GRANT - 5
    assert await _spend_rows(pool, uid, rid) == 1


async def test_rejected_spend_is_retryable_with_same_id(db):
    pool, uid = db
    rid = str(uuid.uuid4())
    ok, bal = await credits_repo.spend(uid, "score", 999, request_id=rid)
    assert (ok, bal) == (False, credits_repo.SIGNUP_GRANT)
    assert await _spend_rows(pool, uid, rid) == 0   # rejection writes no row
    await credits_repo.grant(uid, 1000)
    ok, bal = await credits_repo.spend(uid, "score", 999, request_id=rid)
    assert ok and bal == credits_repo.SIGNUP_GRANT + 1000 - 999


async def test_refund_roundtrip_and_double_refund(db):
    pool, uid = db
    rid = str(uuid.uuid4())
    await credits_repo.spend(uid, "optimize", 5, request_id=rid)
    r1 = await credits_repo.refund(uid, rid)
    assert r1["status"] == "refunded" and r1["refunded"] == 5
    assert r1["balance"] == credits_repo.SIGNUP_GRANT
    r2 = await credits_repo.refund(uid, rid)
    assert r2["status"] == "already_refunded" and r2["refunded"] == 0
    assert await _spend_rows(pool, uid, rid, reason="refund") == 1
    async with pool.acquire() as conn:
        spent_total = await conn.fetchval(
            "SELECT spent_total FROM credits WHERE user_id=$1", uid)
    assert spent_total == 0                 # refund reverses the spend, not money-in


async def test_refund_unknown_request_id(db):
    _, uid = db
    r = await credits_repo.refund(uid, str(uuid.uuid4()))
    assert r["status"] == "spend_not_found" and r["refunded"] == 0


async def test_spend_without_request_id_keeps_legacy_behavior(db):
    pool, uid = db
    ok1, _ = await credits_repo.spend(uid, "score", 4)
    ok2, bal = await credits_repo.spend(uid, "score", 4)
    assert ok1 and ok2 and bal == credits_repo.SIGNUP_GRANT - 8   # two real debits
    async with pool.acquire() as conn:
        n = await conn.fetchval(
            "SELECT count(*) FROM credit_ledger "
            "WHERE user_id=$1 AND reason='spend' AND request_id IS NULL", uid)
    assert n == 2


# ── /credits/refund route gating (no DB needed) ──────────────────────────────

def _dev_auth(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("ALLOW_DEV_AUTH", "1")


def test_refund_route_disabled_without_key(client, monkeypatch):
    _dev_auth(monkeypatch)
    import app.routers.credits as credits_router
    monkeypatch.setattr(credits_router, "_INTERNAL_KEY", "")
    r = client.post("/credits/refund", json={"request_id": "x"},
                    headers={"x-user-id": str(uuid.uuid4()), "x-internal-key": "anything"})
    assert r.status_code == 403


def test_refund_route_rejects_wrong_key_and_accepts_right_one(client, monkeypatch):
    _dev_auth(monkeypatch)
    import app.routers.credits as credits_router
    monkeypatch.setattr(credits_router, "_INTERNAL_KEY", "s3cret")

    async def fake_refund(user_id, request_id):
        return {"refunded": 5, "balance": 50, "status": "refunded",
                "user_id": user_id, "request_id": request_id}
    monkeypatch.setattr(credits_repo, "refund", fake_refund)

    bad = client.post("/credits/refund", json={"request_id": "r-1"},
                      headers={"x-user-id": str(uuid.uuid4()), "x-internal-key": "wrong"})
    assert bad.status_code == 403

    ok = client.post("/credits/refund", json={"request_id": "r-1"},
                     headers={"x-user-id": str(uuid.uuid4()), "x-internal-key": "s3cret"})
    assert ok.status_code == 200 and ok.json()["status"] == "refunded"


def test_spend_route_forwards_request_id(client, monkeypatch):
    _dev_auth(monkeypatch)
    seen = {}

    async def fake_spend(user_id, action, cost, request_id=None):
        seen.update(action=action, cost=cost, request_id=request_id)
        return True, 45
    monkeypatch.setattr(credits_repo, "spend", fake_spend)

    r = client.post("/credits/spend",
                    json={"action": "optimize", "units": 2, "request_id": "req-abc"},
                    headers={"x-user-id": str(uuid.uuid4())})
    assert r.status_code == 200
    assert seen == {"action": "optimize", "cost": 10, "request_id": "req-abc"}
