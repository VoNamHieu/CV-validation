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
from app.search.facet import score_job, rank_jobs, SearchProfile, _UNREACHABLE_FLOOR
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


# ─────────────────────────── embed.build_job_doc ───────────────────────────

def test_build_job_doc_title_only():
    assert build_job_doc("Product Manager") == "Product Manager"


def test_build_job_doc_includes_jd_truncated():
    doc = build_job_doc("PM", jd="x" * 1000)
    assert doc.startswith("PM | ")
    assert "x" * 600 in doc and "x" * 601 not in doc  # jd capped at 600


def test_build_job_doc_includes_skills():
    doc = build_job_doc("PM", must_have=["SQL", "Roadmapping"])
    assert "Skills: SQL, Roadmapping" in doc


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
