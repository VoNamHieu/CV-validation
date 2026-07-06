"""Resolve the current user for user-scoped DB endpoints.

The backend connects with the service-role DSN and therefore **bypasses RLS**,
so user scoping is enforced in application code by the ``user_id`` resolved
here. Resolution paths, in order:

  1. **Asymmetric JWT (this project)** — Supabase signs tokens with an ES256
     key. Tokens in ``Authorization: Bearer <jwt>`` are verified against the
     project's public JWKS (``$SUPABASE_URL/auth/v1/.well-known/jwks.json``).
     No secret needed — the verifying key is public. Just set ``SUPABASE_URL``.
  2. **Legacy HS256** — older projects use a shared ``SUPABASE_JWT_SECRET``.
     Supported as a fallback when that env var is set.
  3. **Dev / pre-auth** — when neither is configured, fall back to an
     ``X-User-Id`` header so the FE can be wired before Supabase Auth lands.

Raises 401 when no user id can be resolved.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import Depends, Header, HTTPException

logger = logging.getLogger(__name__)

_AUDIENCE = "authenticated"
_jwk_client = None  # cached PyJWKClient (caches keys internally)


def _jwks_url() -> str | None:
    base = os.getenv("SUPABASE_URL")
    return f"{base.rstrip('/')}/auth/v1/.well-known/jwks.json" if base else None


def _get_jwk_client():
    global _jwk_client
    if _jwk_client is None:
        url = _jwks_url()
        if not url:
            return None
        import jwt  # PyJWT, lazy
        _jwk_client = jwt.PyJWKClient(url)
    return _jwk_client


def _verify_jwt(token: str) -> str | None:
    """Verify a Supabase JWT and return its ``sub`` (user id), or None when no
    verification path is configured. Raises 401 on a present-but-invalid token."""
    try:
        import jwt  # PyJWT
    except ImportError:  # pragma: no cover
        logger.warning("PyJWT not installed — cannot verify JWT")
        return None

    # Path 1: asymmetric (ES256/RS256) via public JWKS.
    client = _get_jwk_client()
    if client is not None:
        try:
            signing_key = client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token, signing_key.key,
                algorithms=["ES256", "RS256"], audience=_AUDIENCE,
            )
        except Exception as e:  # noqa: BLE001
            logger.info("JWKS JWT verification failed: %s", e)
            raise HTTPException(status_code=401, detail="Invalid auth token")
        return payload.get("sub")

    # Path 2: legacy shared secret (HS256).
    secret = os.getenv("SUPABASE_JWT_SECRET")
    if secret:
        try:
            payload = jwt.decode(
                token, secret, algorithms=["HS256"], audience=_AUDIENCE
            )
        except Exception as e:  # noqa: BLE001
            logger.info("HS256 JWT verification failed: %s", e)
            raise HTTPException(status_code=401, detail="Invalid auth token")
        return payload.get("sub")

    return None


def _auth_configured() -> bool:
    return bool(os.getenv("SUPABASE_URL") or os.getenv("SUPABASE_JWT_SECRET"))


async def get_current_user_id(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> str:
    """FastAPI dependency → the authenticated user's id (a UUID string)."""
    if authorization and authorization.lower().startswith("bearer "):
        uid = _verify_jwt(authorization[7:].strip())
        if uid:
            return uid

    # Dev fallback only when no real auth is configured.
    if not _auth_configured() and x_user_id:
        return x_user_id

    raise HTTPException(status_code=401, detail="Authentication required")


def _admin_emails() -> set[str]:
    return {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}


def super_admin_emails() -> set[str]:
    """The env-configured SUPER admins (``ADMIN_EMAILS``). Public accessor so the
    admin router can render them read-only alongside UI-granted members."""
    return _admin_emails()


async def _resolve_admin(user_id: str) -> Optional[tuple[str, str]]:
    """Return ``(email, role)`` if the caller is an admin, else ``None``.

    ``role`` is ``"super"`` for env-configured admins (``ADMIN_EMAILS``) and
    ``"member"`` for those granted through the admin UI (``admin_members``).
    SUPER wins if an email is in both. The email is read from the caller's
    ``profiles`` row (resolved from the verified JWT ``sub``), so admin status
    can't be spoofed by a header."""
    from app.db import profiles as profiles_repo  # lazy — avoid import cycle
    profile = await profiles_repo.get(user_id)
    email = ((profile or {}).get("email") or "").lower()
    if not email:
        return None
    if email in _admin_emails():
        return email, "super"
    from app.db import admin_members as admin_members_repo  # lazy
    if await admin_members_repo.is_member(email):
        return email, "member"
    return None


async def require_admin(user_id: str = Depends(get_current_user_id)) -> str:
    """Dependency → the caller's user id, only if they're an admin (SUPER *or*
    UI-granted member). Guards operator tooling: ``/admin``, catalog writes on
    ``/store``, and the ``/monitor`` + ``/compat`` panels."""
    if await _resolve_admin(user_id) is None:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user_id


async def require_super_admin(user_id: str = Depends(get_current_user_id)) -> str:
    """Dependency → the caller's user id, only if they're a SUPER admin (env
    ``ADMIN_EMAILS``). Guards the few actions members must not do — currently
    removing admin members."""
    resolved = await _resolve_admin(user_id)
    if not resolved or resolved[1] != "super":
        raise HTTPException(
            status_code=403,
            detail="Chỉ super admin (cấu hình ở backend) mới có quyền này",
        )
    return user_id


async def get_admin_identity(user_id: str = Depends(get_current_user_id)) -> dict:
    """Dependency → ``{user_id, email, role}`` for an admin caller (403 if not).
    Lets endpoints know WHO is acting (e.g. stamping ``added_by``) and their
    role (so the UI can hide member-only-forbidden actions)."""
    resolved = await _resolve_admin(user_id)
    if resolved is None:
        raise HTTPException(status_code=403, detail="Admin access required")
    email, role = resolved
    return {"user_id": user_id, "email": email, "role": role}


async def get_optional_user_id(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> str | None:
    """Like get_current_user_id but returns None instead of 401 — for endpoints
    that work anonymously (e.g. funnel events) yet attach the user when present."""
    if authorization and authorization.lower().startswith("bearer "):
        uid = _verify_jwt(authorization[7:].strip())
        if uid:
            return uid
    if not _auth_configured() and x_user_id:
        return x_user_id
    return None
