"""Full-or-blank JD policy: a listing description is either the whole posting
or "" — never a cut teaser.

The teaser-600 hole: adapters used to store `_strip_html(...)[:600]` stumps
that cleared jd_resolver's _MIN_DESC gate and were served as the "full" JD,
short-circuiting the real fallbacks (Playwright / extension DOM). Now
_shared._full_desc keeps only plausibly-complete text (teaser fields write ""
at the call site), and a static tripwire keeps inline slices from coming back.
"""
import re
from pathlib import Path

import pytest

from app.services.ats_adapters._shared import _FULL_JD_CAP, _full_desc
from app.services import jd_resolver


# ── _full_desc semantics ─────────────────────────────────────────────────────

def test_full_desc_keeps_complete_text():
    assert _full_desc("<p>full posting</p>") == "full posting"


def test_full_desc_blanks_over_cap_instead_of_cutting():
    assert _full_desc("x" * (_FULL_JD_CAP + 1)) == ""


def test_full_desc_keeps_text_at_cap():
    assert _full_desc("x" * _FULL_JD_CAP) == "x" * _FULL_JD_CAP


def test_full_desc_empty_input():
    assert _full_desc(None) == ""
    assert _full_desc("") == ""


# ── resolve_jd_via_ats under the contract ────────────────────────────────────

# No "/job/" and no mbbank/greenhouse host → the by-URL detail adapters all
# pass, exercising the listing-match path.
_URL = "https://careers.example.com/vn/detail/123"


def _listing(monkeypatch, desc):
    monkeypatch.setattr(jd_resolver, "fetch_ats_jobs", lambda u: [
        {"title": "Sales Executive", "url": _URL, "location": "Hà Nội",
         "description": desc},
    ])


def test_resolver_serves_full_listing_description(monkeypatch):
    _listing(monkeypatch, "d" * 300)
    out = jd_resolver.resolve_jd_via_ats(_URL)
    assert out is not None and "d" * 300 in out


def test_resolver_falls_back_on_blank_listing(monkeypatch):
    _listing(monkeypatch, "")
    assert jd_resolver.resolve_jd_via_ats(_URL) is None


def test_resolver_rejects_below_min_desc(monkeypatch):
    _listing(monkeypatch, "d" * (jd_resolver._MIN_DESC - 1))
    assert jd_resolver.resolve_jd_via_ats(_URL) is None


# ── resolve_full_jd: legacy stored teasers must not short-circuit ────────────

@pytest.mark.asyncio
async def test_stored_teaser_still_tries_ats(monkeypatch):
    full = "F" * 900
    monkeypatch.setattr(jd_resolver, "resolve_jd_via_ats", lambda u: full)
    got = await jd_resolver.resolve_full_jd(_URL, existing="t" * 600)
    assert got == full


@pytest.mark.asyncio
async def test_substantial_existing_returns_immediately(monkeypatch):
    def boom(u):  # must not be called at all
        raise AssertionError("resolver ran for a substantial description")
    monkeypatch.setattr(jd_resolver, "resolve_jd_via_ats", boom)
    existing = "E" * jd_resolver._SUBSTANTIAL
    assert await jd_resolver.resolve_full_jd(_URL, existing=existing) == existing


@pytest.mark.asyncio
async def test_teaser_band_never_crawls_to_garbage(monkeypatch):
    # ATS misses and the legacy teaser (200–700) keeps: generic crawl mixes
    # page chrome, so it must stay reserved for truly-thin (<200) descriptions.
    monkeypatch.setattr(jd_resolver, "resolve_jd_via_ats", lambda u: None)
    from app.services import crawler

    async def boom(u):
        raise AssertionError("crawl ran for a teaser-band description")
    monkeypatch.setattr(crawler, "crawl_url", boom)
    teaser = "t" * 600
    assert await jd_resolver.resolve_full_jd(_URL, existing=teaser) == teaser


# ── tripwire: no adapter may slice a description inline again ────────────────

def test_no_inline_description_slices_in_adapters():
    pkg = Path(jd_resolver.__file__).parent / "ats_adapters"
    rx = re.compile(r"[\"']description[\"']\s*:\s*(?!\"\")[^,\n]*\[:\d+\]")
    offenders = [
        f"{p.name}:{i}"
        for p in sorted(pkg.glob("*.py")) if p.name != "_shared.py"
        for i, line in enumerate(p.read_text().splitlines(), 1)
        if rx.search(line)
    ]
    assert not offenders, (
        f"inline description slice violates full-or-blank — use _full_desc() "
        f"(whole posting) or write description=\"\": {offenders}"
    )
