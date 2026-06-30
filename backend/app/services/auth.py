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

from fastapi import Header, HTTPException

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
