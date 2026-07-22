"""Per-branch variant collapse in the search result layer (career._collapse_variants)."""
from app.routers.career import _base_title_key, _collapse_variants


def test_base_title_key_folds_branch_variants_together():
    a = _base_title_key("Chuyên viên Tập sự Khách hàng Cá nhân - CN. Đà Nẵng - Phường Hòa Cường, Đà Nẵng")
    b = _base_title_key("Chuyên viên Tập sự Khách hàng Cá nhân - CN. Huế - Phường Thuận Hóa, Huế")
    c = _base_title_key("CHUYÊN VIÊN TẬP SỰ KHÁCH HÀNG CÁ NHÂN")  # exact, different case/site
    assert a == b == c


def test_base_title_key_strips_leading_location_tag_and_trailing_province():
    assert _base_title_key("[HN,MB] Tập sự tiềm năng Khách hàng Cá nhân") == \
           _base_title_key("[Hà Nội] Tập sự tiềm năng Khách hàng Cá nhân")
    assert _base_title_key("Trưởng ca sản xuất (Tuyên Quang)") == \
           _base_title_key("Trưởng ca sản xuất (Quảng Ngãi)")


def test_collapse_merges_branches_into_one_card_with_province_union():
    ranked = [
        {"title": "Chuyên viên KHCN - CN. Đà Nẵng", "company": "Bank X",
         "location": "Đà Nẵng", "_facet": {"score": 9}},
        {"title": "Chuyên viên KHCN - CN. Huế", "company": "Bank X",
         "location": "Huế", "_facet": {"score": 8}},
        {"title": "Chuyên viên KHCN - CN. Hà Nội", "company": "Bank X",
         "location": "Hà Nội", "_facet": {"score": 7}},
        {"title": "Data Analyst", "company": "Bank X", "location": "Hà Nội",
         "_facet": {"score": 6}},
    ]
    out = _collapse_variants(ranked)
    assert len(out) == 2                       # 3 branches → 1, plus the analyst
    rep = out[0]
    assert rep["variant_count"] == 3
    assert rep["location"] == "Đà Nẵng"        # top-ranked row's province stays primary
    assert rep["locations"] == ["Đà Nẵng", "Huế", "Hà Nội"]
    assert out[1]["title"] == "Data Analyst"   # distinct role untouched


def test_collapse_keeps_different_companies_separate():
    ranked = [
        {"title": "Kế toán - CN. Hà Nội", "company": "A", "location": "Hà Nội", "_facet": {}},
        {"title": "Kế toán - CN. Huế", "company": "B", "location": "Huế", "_facet": {}},
    ]
    out = _collapse_variants(ranked)
    assert len(out) == 2                        # same base role, different company → not merged


def test_collapse_preserves_ranked_order_and_representative():
    ranked = [
        {"title": "Senior Engineer", "company": "C", "location": "Hà Nội", "_facet": {"score": 5}},
        {"title": "Chuyên viên - CN. A", "company": "C", "location": "Huế", "_facet": {"score": 4}},
        {"title": "Chuyên viên - CN. B", "company": "C", "location": "Đà Nẵng", "_facet": {"score": 3}},
    ]
    out = _collapse_variants(ranked)
    assert [o["title"] for o in out] == ["Senior Engineer", "Chuyên viên - CN. A"]
    assert out[1]["variant_count"] == 2
