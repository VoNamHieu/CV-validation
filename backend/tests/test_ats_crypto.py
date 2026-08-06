"""ats_crypto — seal/open, user binding, key rotation, masking.

Pure unit tests (no DB). Each test sets the env itself and clears the cached
keyring, since ``_keyring`` is lru_cached for the process lifetime.
"""
from __future__ import annotations

import base64
import json
import os

import pytest

from app.services import ats_crypto


def _key() -> str:
    return base64.b64encode(os.urandom(32)).decode()


@pytest.fixture(autouse=True)
def _clear_cache():
    ats_crypto._keyring.cache_clear()
    yield
    ats_crypto._keyring.cache_clear()


def _configure(monkeypatch, *, key=None, version="v1", old=None):
    monkeypatch.setenv("ATS_CRED_KEY", key or _key())
    monkeypatch.setenv("ATS_CRED_KEY_VERSION", version)
    if old is None:
        monkeypatch.delenv("ATS_CRED_KEYS_OLD", raising=False)
    else:
        monkeypatch.setenv("ATS_CRED_KEYS_OLD", json.dumps(old))
    ats_crypto._keyring.cache_clear()


def test_unconfigured_is_not_configured(monkeypatch):
    monkeypatch.delenv("ATS_CRED_KEY", raising=False)
    ats_crypto._keyring.cache_clear()
    assert ats_crypto.is_configured() is False
    with pytest.raises(ats_crypto.CryptoNotConfigured):
        ats_crypto.encrypt("hunter2", user_id="u1")


def test_round_trip(monkeypatch):
    _configure(monkeypatch)
    blob, version = ats_crypto.encrypt("Str0ng!Pass", user_id="user-a")
    assert version == "v1"
    assert b"Str0ng!Pass" not in blob        # actually encrypted, not stored raw
    assert ats_crypto.decrypt(blob, version, user_id="user-a") == "Str0ng!Pass"


def test_nonce_makes_ciphertext_unique(monkeypatch):
    _configure(monkeypatch)
    a, _ = ats_crypto.encrypt("same", user_id="u")
    b, _ = ats_crypto.encrypt("same", user_id="u")
    assert a != b                            # no deterministic ciphertext leak


def test_other_user_cannot_open(monkeypatch):
    """user_id is bound as AAD: a row lifted into another user's record fails to
    decrypt rather than silently working."""
    _configure(monkeypatch)
    blob, version = ats_crypto.encrypt("secret", user_id="user-a")
    with pytest.raises(Exception):
        ats_crypto.decrypt(blob, version, user_id="user-b")


def test_tampered_blob_rejected(monkeypatch):
    _configure(monkeypatch)
    blob, version = ats_crypto.encrypt("secret", user_id="u")
    tampered = bytearray(blob)
    tampered[-1] ^= 0x01                     # flip a bit in the GCM tag
    with pytest.raises(Exception):
        ats_crypto.decrypt(bytes(tampered), version, user_id="u")


def test_rotation_keeps_old_rows_readable(monkeypatch):
    """The rotation contract: rows sealed with v1 stay readable after v2 becomes
    current, as long as v1 is retained in ATS_CRED_KEYS_OLD."""
    old_key = _key()
    _configure(monkeypatch, key=old_key, version="v1")
    blob, version = ats_crypto.encrypt("old-pass", user_id="u")
    assert version == "v1"

    _configure(monkeypatch, key=_key(), version="v2", old={"v1": old_key})
    assert ats_crypto.current_key_version() == "v2"
    assert ats_crypto.decrypt(blob, "v1", user_id="u") == "old-pass"
    new_blob, new_version = ats_crypto.encrypt("new-pass", user_id="u")
    assert new_version == "v2"               # new writes use the current key


def test_dropped_key_version_is_a_clear_error(monkeypatch):
    _configure(monkeypatch, version="v1")
    blob, _ = ats_crypto.encrypt("p", user_id="u")
    _configure(monkeypatch, version="v2")    # v1 not retained
    with pytest.raises(ats_crypto.CryptoNotConfigured):
        ats_crypto.decrypt(blob, "v1", user_id="u")


def test_old_map_cannot_shadow_current_key(monkeypatch):
    """A stale entry reusing the current version string must not override it."""
    current = _key()
    _configure(monkeypatch, key=current, version="v2", old={"v2": _key()})
    blob, version = ats_crypto.encrypt("p", user_id="u")
    assert ats_crypto.decrypt(blob, version, user_id="u") == "p"


def test_bad_key_length_is_not_configured(monkeypatch):
    monkeypatch.setenv("ATS_CRED_KEY", base64.b64encode(os.urandom(16)).decode())
    ats_crypto._keyring.cache_clear()
    assert ats_crypto.is_configured() is False


@pytest.mark.parametrize("email,expected", [
    ("hieuvo0106vn@gmail.com", "hi***@gmail.com"),
    ("ab@x.co", "a***@x.co"),      # short local part reveals less, never all of it
    ("a@x.co", "a***@x.co"),
    ("", ""),
    (None, ""),
    ("not-an-email", ""),
])
def test_mask_email(email, expected):
    assert ats_crypto.mask_email(email) == expected
