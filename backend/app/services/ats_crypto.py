"""Application-level encryption for ATS candidate-account passwords.

These are the user's credentials on a THIRD-PARTY site (Workday et al). The
auto-apply agent has to type them back into a login form, so they cannot be
hashed — they must be reversible. That makes them the most sensitive rows in the
database, and the service-role DSN bypasses RLS, so ciphertext (not plaintext)
is what lands in Postgres.

AES-256-GCM, key from the environment. The stored blob is ``nonce || ciphertext``
(GCM's tag is appended to the ciphertext by the library). ``user_id`` is bound in
as additional authenticated data, so a row lifted into another user's record
fails to decrypt instead of silently working.

Key rotation: every row records the ``encryption_key_version`` that sealed it.
``ATS_CRED_KEY`` + ``ATS_CRED_KEY_VERSION`` are the current key; ``ATS_CRED_KEYS_OLD``
is an optional JSON map ``{"v1": "<base64 key>"}`` of retired keys kept only for
decryption. New writes always use the current key.

Unconfigured (no ``ATS_CRED_KEY``) is a hard stop, never a silent plaintext
fallback: ``is_configured()`` is false and the routers return 503, matching the
"unset env var → endpoint disabled" idiom used by webhooks/debug-capture.
"""
from __future__ import annotations

import base64
import json
import os
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE_LEN = 12  # 96-bit nonce, the GCM standard


class CryptoNotConfigured(RuntimeError):
    """Raised when an encrypt/decrypt is attempted without ATS_CRED_KEY set."""


def _decode_key(raw: str) -> bytes:
    key = base64.b64decode(raw.strip(), validate=True)
    if len(key) != 32:
        raise ValueError("ATS_CRED_KEY must decode to exactly 32 bytes (AES-256)")
    return key


@lru_cache(maxsize=1)
def _keyring() -> tuple[str, dict[str, bytes]]:
    """(current_version, {version: key}). Cached — env doesn't change at runtime."""
    current_raw = os.getenv("ATS_CRED_KEY", "").strip()
    if not current_raw:
        return "", {}
    version = os.getenv("ATS_CRED_KEY_VERSION", "v1").strip() or "v1"
    keys = {version: _decode_key(current_raw)}

    old = os.getenv("ATS_CRED_KEYS_OLD", "").strip()
    if old:
        for ver, raw in json.loads(old).items():
            if ver != version:  # never let an old entry shadow the current key
                keys[ver] = _decode_key(raw)
    return version, keys


def is_configured() -> bool:
    """True when an ATS_CRED_KEY is present and well-formed."""
    try:
        return bool(_keyring()[0])
    except (ValueError, json.JSONDecodeError):
        return False


def current_key_version() -> str:
    return _keyring()[0]


def encrypt(plaintext: str, *, user_id: str) -> tuple[bytes, str]:
    """Seal a password. Returns (blob, key_version) for the two DB columns."""
    version, keys = _keyring()
    if not version:
        raise CryptoNotConfigured("ATS_CRED_KEY is not set")
    nonce = os.urandom(_NONCE_LEN)
    ct = AESGCM(keys[version]).encrypt(nonce, plaintext.encode("utf-8"), user_id.encode("utf-8"))
    return nonce + ct, version


def decrypt(blob: bytes, key_version: str, *, user_id: str) -> str:
    """Open a sealed password. Raises if the key version is unknown (rotated out
    without keeping it in ATS_CRED_KEYS_OLD) or the row was tampered with."""
    _, keys = _keyring()
    if not keys:
        raise CryptoNotConfigured("ATS_CRED_KEY is not set")
    key = keys.get(key_version)
    if key is None:
        raise CryptoNotConfigured(f"no key for version {key_version!r}")
    raw = bytes(blob)
    pt = AESGCM(key).decrypt(raw[:_NONCE_LEN], raw[_NONCE_LEN:], user_id.encode("utf-8"))
    return pt.decode("utf-8")


def mask_email(email: str | None) -> str:
    """`hieuvo0106vn@gmail.com` → `hi***@gmail.com`. For the settings panel: the
    user must recognise which address is on file without it being readable to a
    shoulder-surfer, and no endpoint ever returns the password itself."""
    if not email or "@" not in email:
        return ""
    local, _, domain = email.partition("@")
    head = local[:2] if len(local) > 2 else local[:1]
    return f"{head}***@{domain}"
