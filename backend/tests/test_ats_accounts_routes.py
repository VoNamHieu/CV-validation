"""HTTP surface for /me/ats-* — the guards that protect the credentials.

No real DB: both repos are replaced with in-memory fakes that mirror their
user-scoping and lifecycle semantics, so the FULL router path runs (HTTP → auth
dependency → crypto → repo). What's under test is the router's own policy:

  1. no ATS_CRED_KEY → 503 everywhere (never a plaintext fallback)
  2. the password is never returned except by /credential/for-apply
  3. a revoked credential is refused AND flips the tenant to credential_required
  4. only the normalized auth-outcome vocabulary is accepted
  5. user-scoping — user A can't read or write user B's rows

Auth seam: with Supabase unconfigured, get_current_user_id trusts X-User-Id.
"""
from __future__ import annotations

import base64
import os
import uuid

import pytest
from fastapi import Header, HTTPException

from app.db import ats_credentials as creds_repo
from app.db import ats_tenant_accounts as tenants_repo
from app.main import app, RateLimitMiddleware
from app.routers import ats_accounts as router_mod
from app.services import ats_crypto
from app.services.auth import get_current_user_id

TENANT = "aia.wd3.myworkdayjobs.com"


def _rate_limiter():
    if app.middleware_stack is None:
        app.middleware_stack = app.build_middleware_stack()
    node = app.middleware_stack
    for _ in range(20):
        if node is None:
            break
        if isinstance(node, RateLimitMiddleware):
            return node
        node = getattr(node, "app", None)
    return None


async def _header_user(x_user_id: str | None = Header(default=None)):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="no user")
    return x_user_id


class FakeCredentials:
    """Mirrors app.db.ats_credentials, including append-only + revoke cascade."""

    def __init__(self, tenants: "FakeTenants"):
        self.rows: dict[str, dict] = {}
        self.pointer: dict[tuple[str, str], str] = {}
        self.tenants = tenants

    def _insert(self, *, user_id, ats_vendor, credential_type, email,
                password_encrypted, key_version):
        row_id = str(uuid.uuid4())
        row = {
            "id": row_id, "user_id": user_id, "ats_vendor": ats_vendor,
            "credential_type": credential_type, "email": email,
            "password_encrypted": password_encrypted,
            "encryption_key_version": key_version, "lifecycle_state": "active",
            "replaced_by_id": None, "created_at": "2026-07-27T00:00:00Z",
            "retired_at": None, "revoked_at": None,
        }
        self.rows[row_id] = row
        return row

    async def create_default(self, *, user_id, ats_vendor, email,
                             password_encrypted, key_version):
        new = self._insert(user_id=user_id, ats_vendor=ats_vendor,
                           credential_type="default", email=email,
                           password_encrypted=password_encrypted, key_version=key_version)
        prev = self.pointer.get((user_id, ats_vendor))
        if prev and prev != new["id"] and self.rows[prev]["lifecycle_state"] == "active":
            self.rows[prev]["lifecycle_state"] = "retired"
            self.rows[prev]["replaced_by_id"] = new["id"]
        self.pointer[(user_id, ats_vendor)] = new["id"]
        return new

    async def create_tenant_override(self, *, user_id, ats_vendor, email,
                                     password_encrypted, key_version):
        return self._insert(user_id=user_id, ats_vendor=ats_vendor,
                            credential_type="tenant_override", email=email,
                            password_encrypted=password_encrypted, key_version=key_version)

    async def get_default(self, user_id, ats_vendor):
        cid = self.pointer.get((user_id, ats_vendor))
        return self.rows.get(cid) if cid else None

    async def has_active_default(self, user_id, ats_vendor):
        row = await self.get_default(user_id, ats_vendor)
        return bool(row and row["lifecycle_state"] == "active")

    async def get_secret(self, credential_id, user_id):
        row = self.rows.get(credential_id)
        return row if row and row["user_id"] == user_id else None

    async def list_for_user(self, user_id, ats_vendor):
        return [r for r in self.rows.values()
                if r["user_id"] == user_id and r["ats_vendor"] == ats_vendor]

    async def revoke(self, credential_id, user_id):
        row = await self.get_secret(credential_id, user_id)
        if not row or row["lifecycle_state"] == "revoked":
            return None
        row["lifecycle_state"] = "revoked"
        for acct in self.tenants.rows.values():
            if acct["user_id"] == user_id and acct.get("credential_id") == credential_id:
                acct["account_state"] = "credential_required"
                acct["last_error_code"] = "credential_revoked"
        return row


class FakeTenants:
    """Mirrors app.db.ats_tenant_accounts."""

    def __init__(self):
        self.rows: dict[tuple[str, str, str], dict] = {}
        self.attempts: list[dict] = []

    async def get_or_create(self, *, user_id, ats_vendor, tenant_key,
                            canonical_host=None, career_site_key=None, tenant_slug=None):
        key = (user_id, ats_vendor, tenant_key)
        row = self.rows.get(key)
        if row is None:
            row = {
                "id": str(uuid.uuid4()), "user_id": user_id, "ats_vendor": ats_vendor,
                "tenant_key": tenant_key, "canonical_host": canonical_host or tenant_key,
                "career_site_key": career_site_key, "tenant_slug": tenant_slug,
                "credential_id": None, "account_state": "unknown", "signup_via": None,
                "last_error_code": None, "last_error_source": None,
                "last_auth_success_at": None, "verification_requested_at": None,
                "verification_expires_at": None, "next_retry_at": None,
                "created_at": "2026-07-27T00:00:00Z", "updated_at": "2026-07-27T00:00:00Z",
            }
            self.rows[key] = row
        elif career_site_key:
            row["career_site_key"] = career_site_key
        return row

    async def get(self, user_id, ats_vendor, tenant_key):
        return self.rows.get((user_id, ats_vendor, tenant_key))

    async def list_for_user(self, user_id, ats_vendor=None):
        return [r for r in self.rows.values()
                if r["user_id"] == user_id and (not ats_vendor or r["ats_vendor"] == ats_vendor)]

    async def set_state(self, *, user_id, ats_vendor, tenant_key, account_state,
                        signup_via=None, last_error_code=None, last_error_source=None,
                        verification_requested=False, next_retry_at=None):
        if account_state not in tenants_repo.STATES:
            raise ValueError(f"invalid account_state {account_state!r}")
        row = self.rows.get((user_id, ats_vendor, tenant_key))
        if not row:
            return None
        row["account_state"] = account_state
        row["signup_via"] = signup_via or row["signup_via"]
        row["last_error_code"] = last_error_code
        row["last_error_source"] = last_error_source
        if account_state == "ready":
            row["last_auth_success_at"] = "2026-07-27T00:00:00Z"
        if verification_requested and row["verification_requested_at"] is None:
            row["verification_requested_at"] = "2026-07-27T00:00:00Z"
        row["next_retry_at"] = next_retry_at
        return row

    async def set_next_retry(self, *, user_id, ats_vendor, tenant_key, seconds):
        row = self.rows.get((user_id, ats_vendor, tenant_key))
        if row:
            row["next_retry_at"] = f"+{int(seconds)}s"
        return row

    async def pin_credential(self, *, user_id, ats_vendor, tenant_key, credential_id):
        row = self.rows.get((user_id, ats_vendor, tenant_key))
        if row:
            row["credential_id"] = credential_id
        return row

    async def clear_block(self, *, user_id, ats_vendor, tenant_key):
        row = self.rows.get((user_id, ats_vendor, tenant_key))
        if not row:
            return None
        row.update(account_state="unknown", last_error_code=None,
                   last_error_source=None, next_retry_at=None)
        return row

    async def record_attempt(self, **kw):
        self.attempts.append(kw)
        return {"id": str(uuid.uuid4()), **kw}


@pytest.fixture
def fake(monkeypatch):
    tenants = FakeTenants()
    creds = FakeCredentials(tenants)
    for name in ("create_default", "create_tenant_override", "get_default",
                 "has_active_default", "get_secret", "list_for_user", "revoke"):
        monkeypatch.setattr(creds_repo, name, getattr(creds, name))
    for name in ("get_or_create", "get", "list_for_user", "set_state",
                 "set_next_retry", "pin_credential", "clear_block", "record_attempt"):
        monkeypatch.setattr(tenants_repo, name, getattr(tenants, name))

    monkeypatch.setenv("ATS_CRED_KEY", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.setenv("ATS_CRED_KEY_VERSION", "v1")
    monkeypatch.delenv("ATS_CRED_KEYS_OLD", raising=False)
    ats_crypto._keyring.cache_clear()
    monkeypatch.setattr(router_mod, "_ENABLED", True)

    app.dependency_overrides[get_current_user_id] = _header_user
    limiter = _rate_limiter()
    if limiter:
        limiter.clients.clear()
    yield creds, tenants
    app.dependency_overrides.pop(get_current_user_id, None)
    ats_crypto._keyring.cache_clear()
    if limiter:
        limiter.clients.clear()


def _as(user_id):
    return {"X-User-Id": user_id}


def _set_default(client, user="user-A", email="me@x.com", password="Str0ng!Pass"):
    return client.post("/me/ats-credentials/default",
                       json={"atsVendor": "workday", "email": email, "password": password},
                       headers=_as(user))


# ── configuration guard ────────────────────────────────────────────────────
class TestConfigurationGuard:
    def test_no_key_disables_every_endpoint(self, client, fake, monkeypatch):
        monkeypatch.delenv("ATS_CRED_KEY", raising=False)
        ats_crypto._keyring.cache_clear()
        assert client.post("/me/ats-accounts/resolve", json={},
                           headers=_as("user-A")).status_code == 503
        for path in ("/me/ats-credentials/default", "/me/ats-accounts",
                     f"/me/ats-accounts/{TENANT}/credential/for-apply"):
            r = client.get(path, headers=_as("user-A"))
            assert r.status_code == 503, f"GET {path} → {r.status_code}"

    def test_kill_switch_disables_endpoints(self, client, fake, monkeypatch):
        monkeypatch.setattr(router_mod, "_ENABLED", False)
        r = client.get("/me/ats-credentials/default", headers=_as("user-A"))
        assert r.status_code == 503

    def test_unsupported_vendor_rejected(self, client, fake):
        r = client.get("/me/ats-credentials/default?atsVendor=greenhouse",
                       headers=_as("user-A"))
        assert r.status_code == 400


# ── default credential ─────────────────────────────────────────────────────
class TestDefaultCredential:
    def test_set_then_read_is_masked(self, client, fake):
        assert _set_default(client).status_code == 200
        r = client.get("/me/ats-credentials/default", headers=_as("user-A"))
        assert r.status_code == 200
        body = r.json()
        assert body["hasDefaultCredential"] is True
        assert body["email"] == "m***@x.com"
        assert "password" not in body
        assert "Str0ng!Pass" not in r.text

    def test_password_is_encrypted_at_rest(self, client, fake):
        creds, _ = fake
        _set_default(client)
        row = next(iter(creds.rows.values()))
        assert b"Str0ng!Pass" not in row["password_encrypted"]
        assert row["encryption_key_version"] == "v1"

    def test_rotation_retires_previous_row(self, client, fake):
        creds, _ = fake
        _set_default(client, password="Old!2345")
        _set_default(client, password="New!2345")
        states = sorted(r["lifecycle_state"] for r in creds.rows.values())
        assert states == ["active", "retired"]

    def test_missing_password_rejected(self, client, fake):
        r = client.post("/me/ats-credentials/default",
                        json={"atsVendor": "workday", "email": "me@x.com", "password": ""},
                        headers=_as("user-A"))
        assert r.status_code == 400

    def test_validation_error_does_not_echo_the_password(self, client, fake):
        """SecretStr keeps the value out of FastAPI's 422 body."""
        r = client.post("/me/ats-credentials/default",
                        json={"atsVendor": "workday", "password": "Sup3rSecret!"},
                        headers=_as("user-A"))
        assert r.status_code == 422
        assert "Sup3rSecret!" not in r.text


# ── batch start ────────────────────────────────────────────────────────────
class TestResolve:
    def test_unknown_tenant_reported_without_creating_a_row(self, client, fake):
        _, tenants = fake
        _set_default(client)
        r = client.post("/me/ats-accounts/resolve",
                        json={"atsVendor": "workday", "tenants": [{"tenantKey": TENANT}]},
                        headers=_as("user-A"))
        assert r.status_code == 200
        body = r.json()
        assert body["hasDefaultCredential"] is True
        assert body["accounts"][0]["accountState"] == "unknown"
        assert tenants.rows == {}          # resolve is read-only

    def test_no_credential_means_the_modal_must_show(self, client, fake):
        r = client.post("/me/ats-accounts/resolve",
                        json={"atsVendor": "workday", "tenants": []},
                        headers=_as("user-A"))
        assert r.json()["hasDefaultCredential"] is False

    def test_revoked_default_counts_as_no_default(self, client, fake):
        """Otherwise revoking would strand the user: no modal, no usable creds."""
        creds, _ = fake
        _set_default(client)
        cred_id = next(iter(creds.rows))
        import asyncio
        asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
            creds.revoke(cred_id, "user-A")
        )
        r = client.post("/me/ats-accounts/resolve",
                        json={"atsVendor": "workday", "tenants": [{"tenantKey": TENANT}]},
                        headers=_as("user-A"))
        assert r.json()["hasDefaultCredential"] is False


# ── JIT credential fetch ───────────────────────────────────────────────────
class TestCredentialForApply:
    def test_returns_default_and_creates_the_tenant_row(self, client, fake):
        _, tenants = fake
        _set_default(client)
        r = client.get(f"/me/ats-accounts/{TENANT}/credential/for-apply",
                       headers=_as("user-A"))
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == "me@x.com"
        assert body["password"] == "Str0ng!Pass"
        assert body["credentialPinned"] is False
        assert body["accountState"] == "unknown"
        assert len(tenants.rows) == 1      # first contact recorded

    def test_pinned_credential_wins_over_default(self, client, fake):
        _set_default(client, password="Default!1")
        client.post(f"/me/ats-accounts/{TENANT}/credential",
                    json={"atsVendor": "workday", "email": "old@work.com",
                          "password": "Override!1"},
                    headers=_as("user-A"))
        r = client.get(f"/me/ats-accounts/{TENANT}/credential/for-apply",
                       headers=_as("user-A"))
        body = r.json()
        assert body["email"] == "old@work.com"
        assert body["password"] == "Override!1"
        assert body["credentialPinned"] is True

    def test_no_default_is_404(self, client, fake):
        r = client.get(f"/me/ats-accounts/{TENANT}/credential/for-apply",
                       headers=_as("user-A"))
        assert r.status_code == 404

    def test_revoked_credential_refused_and_tenant_flagged(self, client, fake):
        creds, tenants = fake
        _set_default(client)
        client.get(f"/me/ats-accounts/{TENANT}/credential/for-apply", headers=_as("user-A"))
        cred_id = next(iter(creds.rows))
        creds.rows[cred_id]["lifecycle_state"] = "revoked"

        r = client.get(f"/me/ats-accounts/{TENANT}/credential/for-apply",
                       headers=_as("user-A"))
        assert r.status_code == 409
        assert tenants.rows[("user-A", "workday", TENANT)]["account_state"] == "credential_required"

    def test_user_scoping(self, client, fake):
        _set_default(client, user="user-A")
        r = client.get(f"/me/ats-accounts/{TENANT}/credential/for-apply",
                       headers=_as("user-B"))
        assert r.status_code == 404        # B has no credential of their own


# ── auth result reporting ──────────────────────────────────────────────────
class TestAuthResults:
    def _report(self, client, **kw):
        body = {"atsVendor": "workday", "operation": "login", "outcome": "success",
                "source": "dom", **kw}
        return client.post(f"/me/ats-accounts/{TENANT}/auth-results",
                           json=body, headers=_as("user-A"))

    def test_success_marks_ready_and_pins_the_credential(self, client, fake):
        creds, tenants = fake
        _set_default(client)
        cred_id = next(iter(creds.rows))
        r = self._report(client, operation="signup", outcome="success", credentialId=cred_id)
        assert r.status_code == 200
        assert r.json()["accountState"] == "ready"
        acct = tenants.rows[("user-A", "workday", TENANT)]
        assert acct["credential_id"] == cred_id
        assert acct["signup_via"] == "signup"

    def test_verification_required_pins_and_stamps(self, client, fake):
        creds, tenants = fake
        _set_default(client)
        cred_id = next(iter(creds.rows))
        r = self._report(client, operation="signup", outcome="verification_required",
                         credentialId=cred_id)
        assert r.json()["accountState"] == "verification_required"
        acct = tenants.rows[("user-A", "workday", TENANT)]
        assert acct["credential_id"] == cred_id
        assert acct["verification_requested_at"] is not None

    def test_invalid_credentials_blocks_the_tenant(self, client, fake):
        r = self._report(client, outcome="invalid_credentials")
        assert r.json()["accountState"] == "credential_required"

    def test_account_exists_does_not_block(self, client, fake):
        """It's informational — the runner immediately retries as a login."""
        r = self._report(client, operation="signup", outcome="account_exists")
        assert r.json()["accountState"] == "unknown"

    def test_transient_error_leaves_state_untouched(self, client, fake):
        _, tenants = fake
        self._report(client, outcome="success")
        r = self._report(client, outcome="transient_error")
        assert r.json()["accountState"] == "ready"

    def test_rate_limited_sets_backoff(self, client, fake):
        _, tenants = fake
        r = self._report(client, outcome="rate_limited", retryAfterSeconds=900)
        assert r.json()["accountState"] == "temporarily_locked"
        assert tenants.rows[("user-A", "workday", TENANT)]["next_retry_at"] == "+900s"

    @pytest.mark.parametrize("field,value", [
        ("operation", "hack"), ("outcome", "made_up"), ("source", "telepathy"),
    ])
    def test_vocabulary_is_enforced(self, client, fake, field, value):
        r = self._report(client, **{field: value})
        assert r.status_code == 400

    def test_consent_audit_is_recorded(self, client, fake):
        _, tenants = fake
        self._report(client, operation="signup", outcome="success",
                     consentAccepted=["Terms of Use", "Privacy Notice"])
        assert tenants.attempts[-1]["consent_accepted"] == ["Terms of Use", "Privacy Notice"]

    def test_attempt_is_always_logged(self, client, fake):
        _, tenants = fake
        self._report(client, outcome="challenge_required", sourceCode="captcha")
        logged = tenants.attempts[-1]
        assert logged["outcome"] == "challenge_required"
        assert logged["source_code"] == "captcha"


# ── override + retry ───────────────────────────────────────────────────────
class TestOverrideAndRetry:
    def test_override_clears_the_block(self, client, fake):
        _, tenants = fake
        _set_default(client)
        client.post(f"/me/ats-accounts/{TENANT}/auth-results",
                    json={"atsVendor": "workday", "operation": "login",
                          "outcome": "invalid_credentials", "source": "dom"},
                    headers=_as("user-A"))
        r = client.post(f"/me/ats-accounts/{TENANT}/credential",
                        json={"atsVendor": "workday", "email": "old@work.com",
                              "password": "Other!123"},
                        headers=_as("user-A"))
        assert r.status_code == 200
        assert r.json()["accountState"] == "unknown"
        assert r.json()["credentialMode"] == "override"

    def test_resubmitting_the_same_credential_is_rejected(self, client, fake):
        """Otherwise the tenant burns its one retry on a value known to fail."""
        _set_default(client)
        first = client.post(f"/me/ats-accounts/{TENANT}/credential",
                            json={"atsVendor": "workday", "email": "old@work.com",
                                  "password": "Other!123"},
                            headers=_as("user-A"))
        assert first.status_code == 200
        again = client.post(f"/me/ats-accounts/{TENANT}/credential",
                            json={"atsVendor": "workday", "email": "old@work.com",
                                  "password": "Other!123"},
                            headers=_as("user-A"))
        assert again.status_code == 409

    def test_different_password_same_email_is_accepted(self, client, fake):
        _set_default(client)
        client.post(f"/me/ats-accounts/{TENANT}/credential",
                    json={"atsVendor": "workday", "email": "old@work.com",
                          "password": "Other!123"},
                    headers=_as("user-A"))
        r = client.post(f"/me/ats-accounts/{TENANT}/credential",
                        json={"atsVendor": "workday", "email": "old@work.com",
                              "password": "Changed!456"},
                        headers=_as("user-A"))
        assert r.status_code == 200

    def test_retry_resets_to_unknown(self, client, fake):
        _set_default(client)
        client.post(f"/me/ats-accounts/{TENANT}/auth-results",
                    json={"atsVendor": "workday", "operation": "signup",
                          "outcome": "verification_required", "source": "dom"},
                    headers=_as("user-A"))
        r = client.post(f"/me/ats-accounts/{TENANT}/retry", headers=_as("user-A"))
        assert r.status_code == 200
        assert r.json()["accountState"] == "unknown"

    def test_retry_on_unknown_tenant_is_404(self, client, fake):
        r = client.post("/me/ats-accounts/nope.myworkdayjobs.com/retry",
                        headers=_as("user-A"))
        assert r.status_code == 404


# ── settings panel listing ─────────────────────────────────────────────────
class TestListAccounts:
    def test_credential_mode_labels(self, client, fake):
        """default / legacy_default / override must be distinguishable — after a
        rotation, old tenants are healthy, not broken."""
        creds, _ = fake
        _set_default(client, password="Old!2345")
        old_id = next(iter(creds.rows))
        client.get(f"/me/ats-accounts/{TENANT}/credential/for-apply", headers=_as("user-A"))
        client.post(f"/me/ats-accounts/{TENANT}/auth-results",
                    json={"atsVendor": "workday", "operation": "signup",
                          "outcome": "success", "source": "dom", "credentialId": old_id},
                    headers=_as("user-A"))

        listed = client.get("/me/ats-accounts", headers=_as("user-A")).json()["accounts"]
        assert listed[0]["credentialMode"] == "default"

        _set_default(client, password="New!2345")          # rotate
        listed = client.get("/me/ats-accounts", headers=_as("user-A")).json()["accounts"]
        assert listed[0]["credentialMode"] == "legacy_default"

        client.post(f"/me/ats-accounts/{TENANT}/credential",
                    json={"atsVendor": "workday", "email": "old@work.com",
                          "password": "Other!123"},
                    headers=_as("user-A"))
        listed = client.get("/me/ats-accounts", headers=_as("user-A")).json()["accounts"]
        assert listed[0]["credentialMode"] == "override"

    def test_listing_never_leaks_a_password(self, client, fake):
        _set_default(client)
        client.get(f"/me/ats-accounts/{TENANT}/credential/for-apply", headers=_as("user-A"))
        r = client.get("/me/ats-accounts", headers=_as("user-A"))
        assert "Str0ng!Pass" not in r.text
        assert "password" not in r.text.lower()

    def test_user_scoping(self, client, fake):
        _set_default(client, user="user-A")
        client.get(f"/me/ats-accounts/{TENANT}/credential/for-apply", headers=_as("user-A"))
        assert client.get("/me/ats-accounts", headers=_as("user-B")).json()["accounts"] == []
