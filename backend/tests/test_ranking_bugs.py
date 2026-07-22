"""Regression tests for the four verified ranking/classification bugs + the two
cross-module invariants they touch.

All four bugs are now FIXED — these assert the corrected behaviour and guard
against regression, paired with tests locking in what must NOT change while
fixing (real warehouse titles stay Operations, bare "Product Manager" stays
unsignalled, exact company keys keep working, facet's tier order holds). They
were originally landed as xfail(strict) documenting the live defects; once each
fix flipped the xfail to XPASS the markers were removed.

Fixes:
  #1 taxonomy Operations rule: bare "kho" → \\bkho\\b (was matching "khoa"/"khóa")
  #2 company_industry: name normalization + whole-word key match + word-bounded
     fallback (was folding "TikTok Shop"/"Shopee Vietnam" into Retail)
  #3 ranker.rerank: `reachable` restored to the sort tuple (Phase-1 invariant)
  #4 taxonomy seniority: leader/supervisor/giám sát/trưởng nhóm/deputy → Lead/Manager
"""
import pytest

from app.search.taxonomy import classify_title, classify_seniority
from app.search.company_industry import classify_company
from app.search import ranker
from app.search.facet import rank_jobs, SearchProfile


# ─────────────────── BUG #1 — "kho" substring poisons Operations ───────────────
# _norm folds "khóa"/"khoa" → "khoa", which contains "kho"; the Operations rule
# lists a bare "kho", so medical/academic titles match at full 0.8 confidence.
@pytest.mark.parametrize("title", [
    "Bác sĩ đa khoa",
    "Trưởng khoa Dược",
    "Giảng viên khóa học IELTS",
])
def test_kho_substring_does_not_poison_operations(title):
    fam, _conf = classify_title(title)
    assert fam != "Operations", f"{title!r} wrongly classified Operations via 'kho' substring"


def test_genuine_warehouse_stays_operations():
    """The fix (\\bkho\\b) must keep real warehouse/logistics titles in Operations."""
    assert classify_title("Nhân viên kho")[0] == "Operations"
    assert classify_title("Nhân viên kho vận")[0] == "Operations"


# ─────────────────── BUG #2 — industry fallback flips e-commerce → Retail ──────
# classify_company does an exact dict lookup then an unbounded r"retail|shop|..."
# fallback. A naming variant ("TikTok Shop", "Shopee Vietnam") misses the exact
# key and the bare "shop" fallback (also ⊂ "Shopee") drags it to Retail.
@pytest.mark.parametrize("name", ["TikTok Shop", "Shopee Vietnam"])
def test_ecommerce_name_variant_not_retail(name):
    assert classify_company(name) == "E-commerce & Marketplace", \
        f"{name!r} should stay E-commerce, not flip to Retail on a naming variant"


def test_company_exact_keys_and_genuine_retail_unaffected():
    """Exact keys and genuinely-retail fallbacks must keep working after the fix."""
    assert classify_company("TikTok") == "E-commerce & Marketplace"
    assert classify_company("Shopee") == "E-commerce & Marketplace"
    assert classify_company("Winmart Store") == "Retail"   # genuine retail, word-bounded


# ─────────────────── BUG #4 — seniority misses mid-management band ─────────────
# Team Leader / Trưởng nhóm / Supervisor / Giám sát / Deputy Manager return None
# → defaulted to Mid downstream, demoting a Lead/Manager candidate's exact-level
# jobs ~60%. (Bare "Product Manager" → None is INTENTIONAL and must stay.)
# NB: "Team Lead" already works (matches \blead\b) — the gap is specifically the
# titles below that carry NO level word: "Team Leader" (\blead\b misses "leader"),
# Vietnamese "trưởng nhóm"/"giám sát", "Supervisor", and "X Deputy Manager".
@pytest.mark.parametrize("title", [
    "Team Leader", "Trưởng nhóm", "Supervisor", "Giám sát", "Deputy Manager",
])
def test_mid_management_classifies_lead_manager(title):
    assert classify_seniority(title) == "Lead/Manager", \
        f"{title!r} is a Lead/Manager role in the VN market, not an unsignalled default"


def test_seniority_intentional_signals_unaffected():
    """Fixing bug #4 must not disturb the deliberate rules / working matches."""
    assert classify_seniority("Product Manager") is None      # bare manager = no signal (by design)
    assert classify_seniority("Team Lead") == "Lead/Manager"  # already works via \\blead\\b
    assert classify_seniority("Senior Data Analyst") == "Senior"
    assert classify_seniority("Data Intern") == "Intern"
    assert classify_seniority("Head of Marketing") == "Director/Head+"


# ─────────────────── INVARIANT — Phase 1 (facet.rank_jobs) HOLDS ───────────────
# Documented promise: "an unreachable-family job can never outrank a reachable
# one." facet sorts by (is_primary, reachable, score) so this passes — we lock it.
def test_facet_reachable_outranks_unreachable():
    profile = SearchProfile(role_families=["Sales & BD"], cv_families=["Sales & BD"])
    jobs = [
        {"title": "Data Engineer", "company": "X"},       # Data & AI → unreachable for Sales
        {"title": "Sales Executive", "company": "X"},     # Sales & BD → primary, reachable
    ]
    ranked = rank_jobs(jobs, profile)
    assert ranked[0]["_facet"]["reachable"] is True
    # no unreachable row may sit above a reachable one
    seen_unreachable = False
    for j in ranked:
        if not j["_facet"].get("reachable", True):
            seen_unreachable = True
        elif seen_unreachable:
            pytest.fail("a reachable job ranked below an unreachable one in facet output")


# ─────────────────── BUG #3 — Phase 2 (ranker.rerank) BREAKS that invariant ────
# rerank sorts by (literal, is_primary, final) — `reachable` is dropped, so a
# high-cosine unreachable job leapfrogs a lower-cosine reachable one whenever
# they share is_primary=False (the small/niche-pool case).
def test_rerank_preserves_reachable_tier():
    q = [1.0, 0.0]
    unreachable_hi_cos = {  # HR: facet .25, cosine ~1.0
        "title": "HR Business Partner", "_vec": [1.0, 0.0],
        "_facet": {"is_primary": False, "reachable": False, "score": 0.25},
    }
    reachable_lo_cos = {    # BA: facet .44, cosine ~0.0
        "title": "Business Analyst", "_vec": [0.0, 1.0],
        "_facet": {"is_primary": False, "reachable": True, "score": 0.44},
    }
    out = ranker.rerank(q, [unreachable_hi_cos, reachable_lo_cos])
    assert out[0]["_facet"]["reachable"] is True, \
        "unreachable job outranked a reachable one — rerank must tier on `reachable` too"
