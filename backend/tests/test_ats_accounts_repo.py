"""ATS account repos against a REAL Postgres.

The invariants under test are structural — append-only credentials, the pin that
survives a default rotation, revoke beating the pin, and one account row per
canonical host regardless of career site. Mocks can't prove any of them, so this
follows test_credits_repo.py: connect to ``CREDITS_TEST_DSN``, apply migration
015 verbatim, and SKIP cleanly when no server is reachable.
"""
from __future__ import annotations

import base64
import os
import pathlib
import uuid

import pytest

from app.db import ats_credentials as creds_repo
from app.db import ats_tenant_accounts as tenants_repo
from app.services import ats_crypto

_DSN = os.getenv("CREDITS_TEST_DSN", "postgresql://claude:claude@localhost/jobfit_test")
_MIGRATIONS = pathlib.Path(__file__).resolve().parents[1] / "migrations"

_SETUP = """
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    AS $$ SELECT NULL::uuid $$ LANGUAGE sql;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
"""

VENDOR = "workday"


@pytest.fixture
async def db(monkeypatch):
    """Pool on the test DB wired into both repos. Yields (pool, user_id)."""
    asyncpg = pytest.importorskip("asyncpg")
    try:
        pool = await asyncpg.create_pool(_DSN, min_size=1, max_size=5, timeout=3)
    except Exception:
        pytest.skip("no local Postgres for ATS account tests (set CREDITS_TEST_DSN)")
    async with pool.acquire() as conn:
        await conn.execute(_SETUP)
        await conn.execute((_MIGRATIONS / "015_ats_accounts.sql").read_text())
    user_id = str(uuid.uuid4())
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO auth.users (id) VALUES ($1)", user_id)

    async def _pool():
        return pool

    monkeypatch.setattr(creds_repo, "get_pool", _pool)
    monkeypatch.setattr(tenants_repo, "get_pool", _pool)
    monkeypatch.setenv("ATS_CRED_KEY", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.setenv("ATS_CRED_KEY_VERSION", "v1")
    monkeypatch.delenv("ATS_CRED_KEYS_OLD", raising=False)
    ats_crypto._keyring.cache_clear()
    yield pool, user_id
    ats_crypto._keyring.cache_clear()
    await pool.close()


async def _set_default(user_id: str, email: str, password: str) -> dict:
    blob, ver = ats_crypto.encrypt(password, user_id=user_id)
    return await creds_repo.create_default(
        user_id=user_id, ats_vendor=VENDOR, email=email,
        password_encrypted=blob, key_version=ver,
    )


async def _plaintext(cred_id: str, user_id: str) -> str:
    secret = await creds_repo.get_secret(cred_id, user_id)
    return ats_crypto.decrypt(
        secret["password_encrypted"], secret["encryption_key_version"], user_id=user_id
    )


# ── credential lifecycle ───────────────────────────────────────────────────
async def test_first_default_is_active_and_pointed_at(db):
    _, uid = db
    row = await _set_default(uid, "me@x.com", "First!234")
    assert row["lifecycle_state"] == "active"
    assert await creds_repo.has_active_default(uid, VENDOR) is True
    assert str((await creds_repo.get_default(uid, VENDOR))["id"]) == str(row["id"])


async def test_rotation_inserts_and_retires_never_updates(db):
    """The core append-only guarantee: the old row keeps its own ciphertext."""
    _, uid = db
    old = await _set_default(uid, "me@x.com", "Old!2345")
    new = await _set_default(uid, "me@x.com", "New!2345")
    assert str(old["id"]) != str(new["id"])

    all_rows = {str(r["id"]): r for r in await creds_repo.list_for_user(uid, VENDOR)}
    assert all_rows[str(old["id"])]["lifecycle_state"] == "retired"
    assert str(all_rows[str(old["id"])]["replaced_by_id"]) == str(new["id"])
    assert all_rows[str(new["id"])]["lifecycle_state"] == "active"
    # Old password still decrypts to the OLD value — tenants pinned to it work.
    assert await _plaintext(str(old["id"]), uid) == "Old!2345"
    assert await _plaintext(str(new["id"]), uid) == "New!2345"


async def test_pinned_tenant_survives_default_rotation(db):
    """The scenario the whole schema exists for: change the default password, and
    a tenant whose account was created with the old one keeps logging in."""
    _, uid = db
    old = await _set_default(uid, "me@x.com", "Old!2345")
    await tenants_repo.get_or_create(
        user_id=uid, ats_vendor=VENDOR, tenant_key="aia.wd3.myworkdayjobs.com"
    )
    await tenants_repo.pin_credential(
        user_id=uid, ats_vendor=VENDOR, tenant_key="aia.wd3.myworkdayjobs.com",
        credential_id=str(old["id"]),
    )
    await _set_default(uid, "me@x.com", "New!2345")

    acct = await tenants_repo.get(uid, VENDOR, "aia.wd3.myworkdayjobs.com")
    assert str(acct["credential_id"]) == str(old["id"])
    assert await _plaintext(str(acct["credential_id"]), uid) == "Old!2345"


async def test_revoke_beats_the_pin(db):
    """retired ≠ revoked: a compromised credential forces pinned tenants to
    credential_required instead of letting them keep using it."""
    _, uid = db
    cred = await _set_default(uid, "me@x.com", "Leak!234")
    await tenants_repo.get_or_create(
        user_id=uid, ats_vendor=VENDOR, tenant_key="aia.wd3.myworkdayjobs.com"
    )
    await tenants_repo.pin_credential(
        user_id=uid, ats_vendor=VENDOR, tenant_key="aia.wd3.myworkdayjobs.com",
        credential_id=str(cred["id"]),
    )
    await tenants_repo.set_state(
        user_id=uid, ats_vendor=VENDOR, tenant_key="aia.wd3.myworkdayjobs.com",
        account_state="ready",
    )

    await creds_repo.revoke(str(cred["id"]), uid)

    acct = await tenants_repo.get(uid, VENDOR, "aia.wd3.myworkdayjobs.com")
    assert acct["account_state"] == "credential_required"
    assert acct["last_error_code"] == "credential_revoked"
    # And the modal must come back: a revoked default is NOT a usable default.
    assert await creds_repo.has_active_default(uid, VENDOR) is False


async def test_revoke_is_idempotent(db):
    _, uid = db
    cred = await _set_default(uid, "me@x.com", "Leak!234")
    assert await creds_repo.revoke(str(cred["id"]), uid) is not None
    assert await creds_repo.revoke(str(cred["id"]), uid) is None


# ── tenant identity + state ────────────────────────────────────────────────
async def test_same_host_different_career_site_is_one_account(db):
    """Workday's session cookie is host-scoped, so career site must not split the
    account — otherwise a per-tenant override would be asked for twice."""
    _, uid = db
    a = await tenants_repo.get_or_create(
        user_id=uid, ats_vendor=VENDOR, tenant_key="aia.wd3.myworkdayjobs.com",
        career_site_key="External",
    )
    b = await tenants_repo.get_or_create(
        user_id=uid, ats_vendor=VENDOR, tenant_key="aia.wd3.myworkdayjobs.com",
        career_site_key="Campus",
    )
    assert str(a["id"]) == str(b["id"])
    assert len(await tenants_repo.list_for_user(uid, VENDOR)) == 1


async def test_get_or_create_preserves_state_on_second_contact(db):
    _, uid = db
    await tenants_repo.get_or_create(
        user_id=uid, ats_vendor=VENDOR, tenant_key="bosch.wd3.myworkdayjobs.com"
    )
    await tenants_repo.set_state(
        user_id=uid, ats_vendor=VENDOR, tenant_key="bosch.wd3.myworkdayjobs.com",
        account_state="verification_required", verification_requested=True,
    )
    again = await tenants_repo.get_or_create(
        user_id=uid, ats_vendor=VENDOR, tenant_key="bosch.wd3.myworkdayjobs.com",
        career_site_key="External",
    )
    assert again["account_state"] == "verification_required"
    assert again["verification_requested_at"] is not None
    assert again["career_site_key"] == "External"     # metadata still refreshes


async def test_verification_requested_at_keeps_the_first_timestamp(db):
    _, uid = db
    key = "roche.wd3.myworkdayjobs.com"
    await tenants_repo.get_or_create(user_id=uid, ats_vendor=VENDOR, tenant_key=key)
    first = await tenants_repo.set_state(
        user_id=uid, ats_vendor=VENDOR, tenant_key=key,
        account_state="verification_required", verification_requested=True,
    )
    second = await tenants_repo.set_state(
        user_id=uid, ats_vendor=VENDOR, tenant_key=key,
        account_state="verification_required", verification_requested=True,
    )
    assert first["verification_requested_at"] == second["verification_requested_at"]


async def test_ready_stamps_last_auth_success(db):
    _, uid = db
    key = "aia.wd3.myworkdayjobs.com"
    await tenants_repo.get_or_create(user_id=uid, ats_vendor=VENDOR, tenant_key=key)
    blocked = await tenants_repo.set_state(
        user_id=uid, ats_vendor=VENDOR, tenant_key=key,
        account_state="credential_required", last_error_code="invalid_credentials",
    )
    assert blocked["last_auth_success_at"] is None
    ok = await tenants_repo.set_state(
        user_id=uid, ats_vendor=VENDOR, tenant_key=key, account_state="ready",
    )
    assert ok["last_auth_success_at"] is not None


async def test_clear_block_resets_to_unknown(db):
    _, uid = db
    key = "aia.wd3.myworkdayjobs.com"
    await tenants_repo.get_or_create(user_id=uid, ats_vendor=VENDOR, tenant_key=key)
    await tenants_repo.set_state(
        user_id=uid, ats_vendor=VENDOR, tenant_key=key,
        account_state="verification_required", last_error_code="verification_required",
        verification_requested=True,
    )
    row = await tenants_repo.clear_block(user_id=uid, ats_vendor=VENDOR, tenant_key=key)
    assert row["account_state"] == "unknown"
    assert row["last_error_code"] is None
    assert row["next_retry_at"] is None


async def test_invalid_state_rejected(db):
    _, uid = db
    key = "aia.wd3.myworkdayjobs.com"
    await tenants_repo.get_or_create(user_id=uid, ats_vendor=VENDOR, tenant_key=key)
    with pytest.raises(ValueError):
        await tenants_repo.set_state(
            user_id=uid, ats_vendor=VENDOR, tenant_key=key, account_state="bogus"
        )


# ── attempt log ────────────────────────────────────────────────────────────
async def test_attempt_log_is_idempotent(db):
    """An extension network retry must not double-log an attempt that landed."""
    pool, uid = db
    acct = await tenants_repo.get_or_create(
        user_id=uid, ats_vendor=VENDOR, tenant_key="aia.wd3.myworkdayjobs.com"
    )
    key = str(uuid.uuid4())
    first = await tenants_repo.record_attempt(
        user_id=uid, tenant_account_id=str(acct["id"]), operation="signup",
        outcome="verification_required", source="dom", idempotency_key=key,
        consent_accepted=["Terms of Use"],
    )
    second = await tenants_repo.record_attempt(
        user_id=uid, tenant_account_id=str(acct["id"]), operation="signup",
        outcome="verification_required", source="dom", idempotency_key=key,
    )
    assert first is not None
    assert second is None
    async with pool.acquire() as conn:
        n = await conn.fetchval(
            "SELECT count(*) FROM ats_auth_attempts WHERE idempotency_key = $1", key
        )
        consent = await conn.fetchval(
            "SELECT consent_accepted FROM ats_auth_attempts WHERE idempotency_key = $1", key
        )
    assert n == 1
    assert "Terms of Use" in str(consent)


async def test_attempts_without_idempotency_key_all_land(db):
    pool, uid = db
    acct = await tenants_repo.get_or_create(
        user_id=uid, ats_vendor=VENDOR, tenant_key="aia.wd3.myworkdayjobs.com"
    )
    for outcome in ("account_exists", "invalid_credentials"):
        await tenants_repo.record_attempt(
            user_id=uid, tenant_account_id=str(acct["id"]), operation="login",
            outcome=outcome, source="dom",
        )
    async with pool.acquire() as conn:
        n = await conn.fetchval(
            "SELECT count(*) FROM ats_auth_attempts WHERE tenant_account_id = $1",
            acct["id"],
        )
    assert n == 2
