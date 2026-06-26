"""Search layer (Phase 1 facet + Phase 2 embedding rerank).

These exercise the pure-Python search package with no network: the embedding
calls are monkeypatched with a deterministic bag-of-words embedder so cosine
ordering is meaningful and reproducible.
"""
from __future__ import annotations

import math

import pytest

from app.search import ranker, semantic
from app.search.embed import build_job_doc
from app.search.facet import (
    score_job, rank_jobs, SearchProfile, _UNREACHABLE_FLOOR,
    _fit_mult, _effective_level, _seniority_mult, _FIT_FLOOR,
)
from app.search.profile import build_profile


# ─────────────────────────── ranker.cosine ───────────────────────────

def test_cosine_identical_is_one():
    v = [1.0, 2.0, 3.0]
    assert ranker.cosine(v, v) == pytest.approx(1.0)


def test_cosine_orthogonal_is_zero():
    assert ranker.cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_empty_is_zero():
    assert ranker.cosine([], [1.0]) == 0.0
    assert ranker.cosine([1.0], []) == 0.0


# ─────────────────────────── ranker.rerank ───────────────────────────

def test_rerank_blends_facet_and_cosine_and_sorts():
    q = [1.0, 0.0]
    jobs = [
        {"title": "low-cos", "_facet": {"score": 0.9}, "_vec": [0.0, 1.0]},   # facet high, cos 0
        {"title": "high-cos", "_facet": {"score": 0.7}, "_vec": [1.0, 0.0]},  # facet lower, cos 1
    ]
    out = ranker.rerank(q, jobs)
    # blend 0.7*facet + 0.3*cos: low-cos=0.63, high-cos=0.49+0.30=0.79 → high-cos wins
    assert out[0]["title"] == "high-cos"
    assert out[0]["_cos"] == pytest.approx(1.0)
    assert out[0]["_final"] == pytest.approx(0.79, abs=1e-3)
    assert out[1]["_cos"] == pytest.approx(0.0)


def test_rerank_missing_vec_treated_as_zero_cos():
    out = ranker.rerank([1.0, 0.0], [{"title": "x", "_facet": {"score": 0.5}}])
    assert out[0]["_cos"] == 0.0
    assert out[0]["_final"] == pytest.approx(0.35, abs=1e-3)  # 0.7*0.5


def test_rerank_literal_phrase_beats_higher_facet():
    jobs = [
        {"title": "Senior Operations Manager", "_facet": {"score": 1.0, "is_primary": True}, "_vec": [1.0, 0.0]},
        {"title": "Nhân viên Kinh doanh Xuất nhập khẩu", "_facet": {"score": 0.5, "is_primary": False}, "_vec": [0.0, 1.0]},
    ]
    # query_vec favours the Ops job (cos 1.0) AND it's primary w/ higher facet —
    # yet the literal phrase-match wins, joining the top tier.
    out = ranker.rerank([1.0, 0.0], jobs, query_phrase="Xuất nhập khẩu")
    assert out[0]["title"].endswith("Xuất nhập khẩu") and out[0]["_literal"] is True
    # no phrase → the primary higher-facet job wins (literal dimension off)
    out2 = ranker.rerank([1.0, 0.0], jobs, query_phrase="")
    assert out2[0]["title"] == "Senior Operations Manager"


# ─────────────────────────── embed.build_job_doc ───────────────────────────

def test_build_job_doc_title_only():
    # rank word ("Manager") is stripped so the vector encodes domain, not rank
    assert build_job_doc("Product Manager") == "Product"
    # a title with no rank word is unchanged
    assert build_job_doc("Data Engineer") == "Data Engineer"


def test_build_job_doc_includes_jd_truncated():
    doc = build_job_doc("PM", jd="x" * 1000)
    assert doc.startswith("PM | ")
    assert "x" * 600 in doc and "x" * 601 not in doc  # jd capped at 600


def test_build_job_doc_includes_skills():
    doc = build_job_doc("PM", must_have=["SQL", "Roadmapping"])
    assert "Skills: SQL, Roadmapping" in doc


# ─────────────────────────── taxonomy: import/export ───────────────────

def test_import_export_classifies_operations_not_catchall():
    # "Xuất nhập khẩu" / customs had no rule → fell to the General & Management
    # catch-all, so an XNK candidate mis-matched strategy/consultant roles. They
    # must resolve to Operations; strategy titles must stay G&M.
    from app.search.taxonomy import classify_title
    assert classify_title("Chuyên viên Xuất nhập khẩu")[0] == "Operations"
    assert classify_title("Nhân viên Thủ tục Hải quan")[0] == "Operations"
    assert classify_title("Customs Clearance Specialist")[0] == "Operations"
    assert classify_title("Chuyên viên Hợp tác chiến lược")[0] == "General & Management"
    # "Export Sales" is a sales role — Sales is checked before Operations.
    assert classify_title("Export Sales Executive")[0] == "Sales & BD"


def test_audit_batch_recoveries_and_guards():
    from app.search.taxonomy import classify_title
    # Catch-all gaps now routed to real families (coverage-audit batch).
    assert classify_title("Chuyên viên Hành chính")[0] == "Operations"
    assert classify_title("Nhân viên Phục vụ")[0] == "Customer Service"
    assert classify_title("Bếp Trưởng")[0] == "Manufacturing & Technician"
    assert classify_title("Chuyên gia Phát triển Sản phẩm")[0] == "Product"
    assert classify_title("Chuyên viên Thanh tra")[0] == "Legal, Risk & Compliance"
    # Guard: a real "Data Steward" must stay Data & AI (the 'steward' hospitality
    # keyword was dropped precisely because it collided with this).
    assert classify_title("Senior Data Steward")[0] == "Data & AI"


def test_strip_title_noise_keeps_domain_drops_rank():
    from app.search.embed import strip_title_noise
    # rank words gone, domain kept — so the embedding encodes field, not rank
    assert strip_title_noise("Chuyên viên Xuất nhập khẩu") == "Xuất nhập khẩu"
    assert strip_title_noise("CHUYÊN VIÊN VẬN HÀNH").lower() == "vận hành"
    assert strip_title_noise("[Hanoi] - Chuyên viên Senior Data Engineer").lower() == "data engineer"
    # trailing domain parens kept
    assert "customs clearance" in strip_title_noise("Nhân viên Khai báo hải quan (Customs Clearance)").lower()
    # never empties — a rank-only title falls back to the original
    assert strip_title_noise("Chuyên viên") == "Chuyên viên"


def test_garbage_title_filter():
    from app.routers.career import _is_garbage_title
    assert _is_garbage_title("Find Jobs")
    assert _is_garbage_title("Tầng 1, số 11B Cát Linh, Phường Ô Chợ Dừa, Hà Nội")
    assert _is_garbage_title("🔍 PGD Láng Hạ, TP. Hà Nội")
    # Real jobs kept — incl. "số hóa" (digitalization), which is not an address.
    assert not _is_garbage_title("Chuyên viên Số hóa Ngân hàng")
    assert not _is_garbage_title("Senior Product Manager")
    assert not _is_garbage_title("Nhân viên Phục vụ")


# ─────────────────────────── facet.score_job ───────────────────────────

def test_score_job_soft_floors_unreachable_family():
    # profile only retrieves Engineering-adjacent families; a far role is NOT
    # dropped — it's soft-floored (reachable=False) so it stays pivot-able but
    # ranks dead last behind any reachable family.
    prof = build_profile(["Backend Software Engineer"])
    rw = prof.expanded_roles()
    far = score_job({"title": "Registered Nurse"}, prof, rw, industry="Pharma & Healthcare")
    assert far is not None
    assert far["reachable"] is False
    assert far["role_w"] == _UNREACHABLE_FLOOR
    # A reachable in-family role outranks the floored one in rank_jobs tiering.
    near = score_job({"title": "Backend Software Engineer"}, prof, rw)
    assert near["reachable"] is True and near["score"] > far["score"]


def test_score_job_location_filter_drops_mismatch():
    prof = build_profile(["Product Manager"], desired_locations=["Ho Chi Minh"])
    rw = prof.expanded_roles()
    out = score_job({"title": "Product Manager", "location": "Hanoi"}, prof, rw)
    assert out is None


def test_score_job_in_domain_beats_out_of_domain():
    prof = build_profile(["Product Manager"], domains=["Fintech & Payments"])
    rw = prof.expanded_roles()
    job = {"title": "Product Manager"}
    in_dom = score_job(job, prof, rw, industry="Fintech & Payments")
    out_dom = score_job(job, prof, rw, industry="Retail")
    assert in_dom["in_domain"] is True and out_dom["in_domain"] is False
    assert in_dom["score"] > out_dom["score"]


def test_fit_mult_neutral_same_and_floored_far():
    assert _fit_mult("Product", []) == 1.0                  # no CV → neutral (back-compat)
    assert _fit_mult("Product", ["Product"]) == 1.0         # same family → 1.0
    assert _fit_mult("Manufacturing & Technician", ["Product"]) == _FIT_FLOOR  # far → floor, not 0


def test_effective_level_discounts_pivot_never_raises():
    assert _effective_level("Senior", 1.0) == "Senior"              # same family → unchanged
    assert _effective_level("Senior", 0.4) == "Mid"                 # pivot → discounted down
    # 0.75 is a real edge weight (Eng↔Data); round-half-UP → drop 1, not 0.
    assert _effective_level("Senior", 0.75) == "Mid"
    assert _effective_level("Intern/Fresher", 0.4) == "Intern/Fresher"  # never raised
    assert _effective_level("", 0.4) == ""                          # no level → neutral


def test_seniority_mid_default_only_on_clear_gap():
    # A bare title (no level word) is assumed Mid, but only acts on a >=2 gap.
    assert _seniority_mult(None, "Mid") == 1.0          # gap 0
    assert _seniority_mult(None, "Senior") == 1.0       # gap 1 → neutral (near-fit guard)
    assert _seniority_mult(None, "Director/Head+") == 0.4   # gap 3 → demote
    assert _seniority_mult(None, "") == 1.0             # unknown profile → neutral


def test_one_to_one_unaffected_by_fit():
    # Same target & CV family, in-domain → fit 1.0, score identical to no-CV.
    prof_no_cv = build_profile(["Product Manager"], domains=["Fintech & Payments"])
    prof_cv = build_profile(["Product Manager"], domains=["Fintech & Payments"])
    prof_cv.cv_families = ["Product"]
    rw = prof_cv.expanded_roles()
    job = {"title": "Product Manager"}
    a = score_job(job, prof_no_cv, prof_no_cv.expanded_roles(), industry="Fintech & Payments")
    b = score_job(job, prof_cv, rw, industry="Fintech & Payments")
    assert a["score"] == b["score"] and b["fit_mult"] == 1.0


def test_rank_jobs_sorts_by_facet_score_desc():
    prof = build_profile(["Product Manager"], domains=["Fintech & Payments"])
    jobs = [
        {"title": "Product Manager", "industry": "Retail"},             # out of domain
        {"title": "Product Manager", "industry": "Fintech & Payments"}, # in domain
    ]
    ranked = rank_jobs(jobs, prof)
    assert [j["industry"] for j in ranked] == ["Fintech & Payments", "Retail"]
    assert all("_facet" in j for j in ranked)


# ─────────────────────────── profile.build_profile ───────────────────────────

def test_build_profile_maps_roles_to_families():
    prof = build_profile(["Senior Product Manager"])
    assert prof.role_families == ["Product"]


def test_build_profile_maps_free_text_domains_to_canonical():
    # loose aliases ("fintech", "tech") map to vocab; canonical passes through;
    # dupes collapse; unknowns drop
    prof = build_profile(["PM"], domains=["fintech", "Fintech & Payments", "tech", "spaceship"])
    assert prof.domains == ["Fintech & Payments", "Technology Platform / SaaS"]


def test_build_profile_domains_accent_and_case_insensitive():
    assert build_profile(["PM"], domains=["FINTECH"]).domains == ["Fintech & Payments"]
    assert build_profile(["PM"], domains=["banking"]).domains == ["Banking"]


def test_build_profile_defaults_role_family_when_empty():
    assert build_profile([]).role_families == ["General & Management"]


# ─────────────────────────── semantic.rerank_bucket ───────────────────────────

_VOCAB = ["payment", "fintech", "data", "hr", "product"]


def _bow(text: str) -> list[float]:
    """Deterministic bag-of-words unit vector over a fixed vocab."""
    t = text.lower()
    v = [1.0 if w in t else 0.0 for w in _VOCAB]
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


@pytest.fixture
def fake_embed(monkeypatch):
    """Replace network embedders + Redis cache with in-memory deterministic stubs."""
    calls = {"job_docs": [], "n_job_calls": 0}

    def embed_jobs(docs):
        calls["job_docs"].extend(docs)
        calls["n_job_calls"] += 1
        return [_bow(d) for d in docs]

    monkeypatch.setattr(semantic, "embed_jobs", embed_jobs)
    monkeypatch.setattr(semantic, "embed_query", lambda t: _bow(t))

    store: dict = {}

    async def get_json(k):
        return store.get(k)

    async def set_json(k, v, ttl):
        store[k] = v

    monkeypatch.setattr(semantic.cache, "get_json", get_json)
    monkeypatch.setattr(semantic.cache, "set_json", set_json)
    return calls


async def test_rerank_bucket_orders_by_semantic_similarity(fake_embed):
    jobs = [
        {"title": "HR Manager", "description": "people ops", "_facet": {"score": 0.8}},
        {"title": "Payment Product Manager", "description": "payment fintech rails",
         "_facet": {"score": 0.8}},
    ]
    out = await semantic.rerank_bucket(jobs, "payment fintech role", top=60)
    # equal facet → cosine breaks the tie; the payment job wins
    assert out[0]["title"] == "Payment Product Manager"
    assert out[0]["_cos"] > out[1]["_cos"]


async def test_rerank_bucket_embeds_jd_not_just_title(fake_embed):
    jobs = [{"title": "PM", "description": "owns the payment platform",
             "_facet": {"score": 0.5}}]
    await semantic.rerank_bucket(jobs, "payment", top=60)
    # the JD text must reach the embedder (regression: was title-only)
    assert any("payment platform" in d for d in fake_embed["job_docs"])


async def test_rerank_bucket_caches_and_skips_reembed(fake_embed):
    jobs = [{"title": "Payment PM", "description": "payment", "_facet": {"score": 0.5}}]
    await semantic.rerank_bucket(list(jobs), "payment", top=60)
    first = fake_embed["n_job_calls"]
    await semantic.rerank_bucket(list(jobs), "payment", top=60)
    # second pass hits the (in-memory) cache → no new job-embed batch call
    assert fake_embed["n_job_calls"] == first


async def test_rerank_bucket_passthrough_on_empty():
    assert await semantic.rerank_bucket([], "q") == []
    assert await semantic.rerank_bucket([{"title": "x"}], "") == [{"title": "x"}]
