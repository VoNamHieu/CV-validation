"""ATS candidate-account API (``/me/ats-*``).

Backs the auto-apply agent's per-tenant login/signup. Three kinds of caller:

* the **web app** at batch start (``/resolve``) and from the settings panel
  (masked reads, default change, per-tenant override),
* the **extension** just-in-time, right before it authenticates one tenant
  (``/credential/for-apply``) and right after (``/auth-results``),
* the **user** unblocking a tenant (``/retry``).

Secrets never travel except through ``/credential/for-apply``, which hands back
exactly one tenant's credential. Everything else is masked. The password field is
``SecretStr`` so a 422 validation error can't echo it back to the client.

Disabled (503) unless ``ATS_CRED_KEY`` is configured — encryption is not optional,
and a silent plaintext fallback would be worse than an outage.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, SecretStr

from app.db import ats_credentials, ats_tenant_accounts
from app.services import ats_crypto
from app.services.auth import get_current_user_id

router = APIRouter(prefix="/me", tags=["ATS Accounts"])

#: Kill switch. The real prerequisite is ATS_CRED_KEY (below); this exists so the
#: feature can be turned off without pulling the encryption key out from under
#: rows already written.
_ENABLED = os.getenv("ATS_ACCOUNTS_ENABLED", "1").strip().lower() not in ("0", "false", "no")

_VENDORS = ("workday",)

#: Outcomes the extension may report, and the tenant state each implies. Anything
#: outside this map is rejected — the classifier is the only place that decides
#: what a raw ATS signal means, and it must speak this vocabulary.
_OUTCOME_TO_STATE = {
    "success": "ready",
    "account_exists": "unknown",          # informational: caller retries as login
    "invalid_credentials": "credential_required",
    "verification_required": "verification_required",
    "password_reset_required": "password_reset_required",
    "consent_required": "consent_required",
    "challenge_required": "challenge_required",
    "temporarily_locked": "temporarily_locked",
    "rate_limited": "temporarily_locked",
    "unsupported": "unsupported",
    "transient_error": None,              # leave the state alone; runner backs off
    "unknown_error": None,
}

_OPERATIONS = ("login", "signup", "verify_retry", "submission_reconcile")
_SOURCES = ("authgwy", "cxs", "dom", "server")


def _guard() -> None:
    if not _ENABLED:
        raise HTTPException(status_code=503, detail="ATS accounts disabled")
    if not ats_crypto.is_configured():
        raise HTTPException(
            status_code=503, detail="ATS accounts not configured (no ATS_CRED_KEY)"
        )


def _check_vendor(vendor: str) -> str:
    v = (vendor or "").strip().lower()
    if v not in _VENDORS:
        raise HTTPException(status_code=400, detail=f"unsupported ats vendor {vendor!r}")
    return v


def _credential_mode(account: dict, default_id: Optional[str], by_id: dict) -> str:
    """How the UI should label this tenant.

    Distinguishing ``legacy_default`` matters: after the user rotates their
    default password, every previously-created tenant still pins the old
    credential. That is healthy, not broken — labelling them all "different
    password" would paint the whole list red for no reason.
    """
    cred_id = account.get("credential_id")
    if not cred_id:
        return "default"
    cred_id = str(cred_id)
    if default_id and cred_id == default_id:
        return "default"
    cred = by_id.get(cred_id)
    if cred and cred["credential_type"] == "tenant_override":
        return "override"
    return "legacy_default"


def _public_account(account: dict, default_id: Optional[str], by_id: dict) -> dict:
    return {
        "tenantKey": account["tenant_key"],
        "canonicalHost": account["canonical_host"],
        "careerSiteKey": account.get("career_site_key"),
        "accountState": account["account_state"],
        "credentialMode": _credential_mode(account, default_id, by_id),
        "lastErrorCode": account.get("last_error_code"),
        "verificationRequestedAt": account.get("verification_requested_at"),
        "nextRetryAt": account.get("next_retry_at"),
        "lastAuthSuccessAt": account.get("last_auth_success_at"),
        "updatedAt": account.get("updated_at"),
    }


async def _index(user_id: str, vendor: str) -> tuple[Optional[str], dict]:
    """(current default credential id, {id: credential}) for label derivation."""
    creds = await ats_credentials.list_for_user(user_id, vendor)
    by_id = {str(c["id"]): c for c in creds}
    default = await ats_credentials.get_default(user_id, vendor)
    default_id = str(default["id"]) if default and default["lifecycle_state"] == "active" else None
    return default_id, by_id


# ── batch start ────────────────────────────────────────────────────────────
class TenantRef(BaseModel):
    tenantKey: str
    canonicalHost: Optional[str] = None
    careerSiteKey: Optional[str] = None
    tenantSlug: Optional[str] = None


class ResolveRequest(BaseModel):
    atsVendor: str = "workday"
    tenants: list[TenantRef] = []


@router.post("/ats-accounts/resolve")
async def resolve_accounts(
    body: ResolveRequest, user_id: str = Depends(get_current_user_id)
):
    """What the runner needs before a batch: do we have a usable default, and
    what is each tenant's standing verdict?

    Read-only — it does NOT create tenant rows. First contact is recorded by the
    JIT credential fetch, so a batch that never reaches a tenant leaves no trace.
    """
    _guard()
    vendor = _check_vendor(body.atsVendor)
    default_id, by_id = await _index(user_id, vendor)

    known = {a["tenant_key"]: a for a in await ats_tenant_accounts.list_for_user(user_id, vendor)}
    accounts = []
    for ref in body.tenants:
        row = known.get(ref.tenantKey)
        if row:
            accounts.append(_public_account(row, default_id, by_id))
        else:
            accounts.append({
                "tenantKey": ref.tenantKey,
                "canonicalHost": ref.canonicalHost or ref.tenantKey,
                "careerSiteKey": ref.careerSiteKey,
                "accountState": "unknown",
                "credentialMode": "default",
                "lastErrorCode": None,
                "verificationRequestedAt": None,
                "nextRetryAt": None,
                "lastAuthSuccessAt": None,
                "updatedAt": None,
            })
    return {
        "atsVendor": vendor,
        "hasDefaultCredential": await ats_credentials.has_active_default(user_id, vendor),
        "accounts": accounts,
    }


# ── default credential ─────────────────────────────────────────────────────
class DefaultCredentialCreate(BaseModel):
    atsVendor: str = "workday"
    email: str
    password: SecretStr


@router.get("/ats-credentials/default")
async def get_default_credential(
    atsVendor: str = Query(default="workday"),
    user_id: str = Depends(get_current_user_id),
):
    """Masked view for the settings panel. There is no endpoint that reveals the
    password to the browser — the agent gets it, the UI never does."""
    _guard()
    vendor = _check_vendor(atsVendor)
    row = await ats_credentials.get_default(user_id, vendor)
    active = bool(row and row["lifecycle_state"] == "active")
    return {
        "atsVendor": vendor,
        "hasDefaultCredential": active,
        "email": ats_crypto.mask_email(row["email"]) if row else "",
        "lifecycleState": row["lifecycle_state"] if row else None,
        "updatedAt": row["created_at"] if row else None,
    }


@router.post("/ats-credentials/default")
async def set_default_credential(
    body: DefaultCredentialCreate, user_id: str = Depends(get_current_user_id)
):
    """Create or rotate the default. Always an INSERT — tenants pinned to the
    outgoing credential keep using it, because that is the password their
    candidate account was actually created with."""
    _guard()
    vendor = _check_vendor(body.atsVendor)
    email = body.email.strip()
    password = body.password.get_secret_value()
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password are required")

    blob, key_version = ats_crypto.encrypt(password, user_id=user_id)
    row = await ats_credentials.create_default(
        user_id=user_id, ats_vendor=vendor, email=email,
        password_encrypted=blob, key_version=key_version,
    )
    return {
        "id": str(row["id"]),
        "atsVendor": vendor,
        "email": ats_crypto.mask_email(row["email"]),
        "createdAt": row["created_at"],
    }


# ── tenant accounts ────────────────────────────────────────────────────────
@router.get("/ats-accounts")
async def list_accounts(
    atsVendor: str = Query(default="workday"),
    user_id: str = Depends(get_current_user_id),
):
    """Tenant list for the settings panel + the "Cần bạn xử lý" section."""
    _guard()
    vendor = _check_vendor(atsVendor)
    default_id, by_id = await _index(user_id, vendor)
    rows = await ats_tenant_accounts.list_for_user(user_id, vendor)
    return {
        "atsVendor": vendor,
        "hasDefaultCredential": await ats_credentials.has_active_default(user_id, vendor),
        "accounts": [_public_account(r, default_id, by_id) for r in rows],
    }


class TenantOverrideCreate(BaseModel):
    atsVendor: str = "workday"
    email: str
    password: SecretStr
    canonicalHost: Optional[str] = None
    careerSiteKey: Optional[str] = None


@router.post("/ats-accounts/{tenant_key}/credential")
async def set_tenant_override(
    tenant_key: str,
    body: TenantOverrideCreate,
    user_id: str = Depends(get_current_user_id),
):
    """Per-tenant credential for an account that predates us (or uses a different
    address). Clears the block so the next batch re-probes this tenant once.

    Re-submitting the credential that is already pinned is rejected rather than
    stored: it would burn the tenant's one retry on a value we know fails. The
    check decrypts and compares in memory — deliberately no password hash is
    persisted alongside reversible ciphertext.
    """
    _guard()
    vendor = _check_vendor(body.atsVendor)
    email = body.email.strip()
    password = body.password.get_secret_value()
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password are required")

    account = await ats_tenant_accounts.get_or_create(
        user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key,
        canonical_host=body.canonicalHost, career_site_key=body.careerSiteKey,
    )

    if account.get("credential_id"):
        current = await ats_credentials.get_secret(str(account["credential_id"]), user_id)
        if current and current["lifecycle_state"] != "revoked":
            try:
                same = (
                    current["email"].strip().lower() == email.lower()
                    and ats_crypto.decrypt(
                        current["password_encrypted"],
                        current["encryption_key_version"],
                        user_id=user_id,
                    ) == password
                )
            except Exception:
                same = False  # undecryptable (rotated-out key) → let the new one through
            if same:
                raise HTTPException(
                    status_code=409,
                    detail="Thông tin này trùng với thông tin đã thử cho công ty này.",
                )

    blob, key_version = ats_crypto.encrypt(password, user_id=user_id)
    cred = await ats_credentials.create_tenant_override(
        user_id=user_id, ats_vendor=vendor, email=email,
        password_encrypted=blob, key_version=key_version,
    )
    await ats_tenant_accounts.pin_credential(
        user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key,
        credential_id=str(cred["id"]),
    )
    row = await ats_tenant_accounts.clear_block(
        user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key
    )
    default_id, by_id = await _index(user_id, vendor)
    return _public_account(row, default_id, by_id)


@router.post("/ats-accounts/{tenant_key}/retry")
async def retry_tenant(
    tenant_key: str,
    atsVendor: str = Query(default="workday"),
    user_id: str = Depends(get_current_user_id),
):
    """The user says they've done their part (clicked the verification link).
    Moves the tenant back to ``unknown`` so the runner probes it exactly once
    more. This endpoint never authenticates — polling logins is what gets
    accounts locked."""
    _guard()
    vendor = _check_vendor(atsVendor)
    row = await ats_tenant_accounts.clear_block(
        user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tenant account not found")
    default_id, by_id = await _index(user_id, vendor)
    return _public_account(row, default_id, by_id)


# ── extension: JIT credential + result reporting ───────────────────────────
@router.get("/ats-accounts/{tenant_key}/credential/for-apply")
async def credential_for_apply(
    tenant_key: str,
    atsVendor: str = Query(default="workday"),
    canonicalHost: Optional[str] = Query(default=None),
    careerSiteKey: Optional[str] = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    """The one endpoint that returns a plaintext password, scoped to a single
    tenant and fetched immediately before the agent authenticates.

    Resolution: pinned credential if the tenant has one, else the current
    default. A revoked credential is refused outright (409) and the tenant is
    flagged ``credential_required`` — a compromised secret must not keep being
    used just because a foreign key still points at it.
    """
    _guard()
    vendor = _check_vendor(atsVendor)
    # First contact creates the row, so the auth-result that follows has a home.
    account = await ats_tenant_accounts.get_or_create(
        user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key,
        canonical_host=canonicalHost, career_site_key=careerSiteKey,
    )

    cred_id = account.get("credential_id")
    pinned = bool(cred_id)
    if not pinned:
        default = await ats_credentials.get_default(user_id, vendor)
        if not default:
            raise HTTPException(status_code=404, detail="No default credential on file")
        cred_id = default["id"]

    secret = await ats_credentials.get_secret(str(cred_id), user_id)
    if not secret:
        raise HTTPException(status_code=404, detail="Credential not found")
    if secret["lifecycle_state"] == "revoked":
        await ats_tenant_accounts.set_state(
            user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key,
            account_state="credential_required",
            last_error_code="credential_revoked", last_error_source="server",
        )
        raise HTTPException(status_code=409, detail="Credential revoked")

    try:
        password = ats_crypto.decrypt(
            secret["password_encrypted"], secret["encryption_key_version"], user_id=user_id
        )
    except ats_crypto.CryptoNotConfigured as e:
        # Key rotated away without keeping the old one — recoverable only by the
        # user supplying the credential again.
        raise HTTPException(status_code=409, detail=f"Credential unreadable: {e}")

    return {
        "tenantKey": tenant_key,
        "accountState": account["account_state"],
        "credentialId": str(cred_id),
        "credentialPinned": pinned,
        "email": secret["email"],
        "password": password,
    }


class AuthResultReport(BaseModel):
    atsVendor: str = "workday"
    operation: str
    outcome: str
    source: str
    sourceCode: Optional[str] = None
    credentialId: Optional[str] = None
    retryable: bool = False
    retryAfterSeconds: Optional[int] = None
    batchId: Optional[str] = None
    idempotencyKey: Optional[str] = None
    automationVersion: Optional[str] = None
    consentAccepted: Optional[list[str]] = None
    canonicalHost: Optional[str] = None
    careerSiteKey: Optional[str] = None


@router.post("/ats-accounts/{tenant_key}/auth-results")
async def report_auth_result(
    tenant_key: str,
    body: AuthResultReport,
    user_id: str = Depends(get_current_user_id),
):
    """Record what happened when the agent authenticated at this tenant, and move
    the tenant's durable state accordingly. The extension sends normalized
    outcomes only — this endpoint refuses anything outside the vocabulary rather
    than storing a free-text blob it can't reason about later."""
    _guard()
    vendor = _check_vendor(body.atsVendor)
    if body.operation not in _OPERATIONS:
        raise HTTPException(status_code=400, detail=f"invalid operation {body.operation!r}")
    if body.outcome not in _OUTCOME_TO_STATE:
        raise HTTPException(status_code=400, detail=f"invalid outcome {body.outcome!r}")
    if body.source not in _SOURCES:
        raise HTTPException(status_code=400, detail=f"invalid source {body.source!r}")

    account = await ats_tenant_accounts.get_or_create(
        user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key,
        canonical_host=body.canonicalHost, career_site_key=body.careerSiteKey,
    )

    # Pin the credential that actually opened/created the account, so a later
    # default rotation leaves this tenant working.
    if body.credentialId and body.outcome in ("success", "verification_required"):
        await ats_tenant_accounts.pin_credential(
            user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key,
            credential_id=body.credentialId,
        )

    new_state = _OUTCOME_TO_STATE[body.outcome]
    row = account
    if new_state:
        row = await ats_tenant_accounts.set_state(
            user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key,
            account_state=new_state,
            signup_via="signup" if body.operation == "signup" and body.outcome in (
                "success", "verification_required") else None,
            last_error_code=None if body.outcome == "success" else body.outcome,
            last_error_source=None if body.outcome == "success" else body.source,
            verification_requested=(body.outcome == "verification_required"),
            next_retry_at=None,
        ) or account
        if body.retryAfterSeconds and body.retryAfterSeconds > 0:
            row = await ats_tenant_accounts.set_next_retry(
                user_id=user_id, ats_vendor=vendor, tenant_key=tenant_key,
                seconds=body.retryAfterSeconds,
            ) or row

    await ats_tenant_accounts.record_attempt(
        user_id=user_id, tenant_account_id=str(account["id"]),
        operation=body.operation, outcome=body.outcome, source=body.source,
        source_code=body.sourceCode, consent_accepted=body.consentAccepted,
        retryable=body.retryable, batch_id=body.batchId,
        idempotency_key=body.idempotencyKey, automation_version=body.automationVersion,
    )

    default_id, by_id = await _index(user_id, vendor)
    return _public_account(row, default_id, by_id)
