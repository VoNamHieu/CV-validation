"""Province normalizer: folds free-form scraped location text to canonical VN
provinces (see app/search/location.py)."""
from app.search.location import canon_provinces, primary_province, clean_location


def test_dedups_repeated_and_strips_country_suffix():
    assert canon_provinces("Hồ Chí Minh, Hồ Chí Minh, Hồ Chí Minh") == ["Hồ Chí Minh"]
    assert canon_provinces("Ho Chi Minh City, VN") == ["Hồ Chí Minh"]
    assert canon_provinces("TP. Ha Noi, VN") == ["Hà Nội"]


def test_folds_language_and_abbrev_variants_of_same_city():
    for raw in ("HCMC, VN", "TP. Ho Chi Minh", "Thành phố Hồ Chí Minh, VN",
                "District 2, Thu Duc City, Ho Chi Minh, VN", "Sài Gòn"):
        assert canon_provinces(raw) == ["Hồ Chí Minh"], raw
    assert canon_provinces("Thang Long, Vietnam") == ["Hà Nội"]


def test_drops_junk_segments_but_keeps_province():
    assert canon_provinces("TP. Ho Chi Minh, VP. Phu Nu") == ["Hồ Chí Minh"]
    assert canon_provinces("Vietnam, Hồ Chí Minh, Ho Chi Minh City, 71100") == ["Hồ Chí Minh"]


def test_ward_prefixed_segment_is_not_a_province():
    # "Phường Vĩnh Phúc" is a WARD inside Phú Thọ, not Vĩnh Phúc province.
    assert canon_provinces("Phường Vĩnh Phúc, Phú Thọ") == ["Phú Thọ"]
    assert canon_provinces("Phường Quy Nhơn Nam, Gia Lai") == ["Gia Lai"]
    assert canon_provinces("Xã Quang Minh, Hà Nội") == ["Hà Nội"]


def test_multi_site_posting_lists_each_province_in_order():
    assert canon_provinces("An Giang, Cà Mau, Cần Thơ, Đồng Tháp, Vĩnh Long") == \
        ["An Giang", "Cà Mau", "Cần Thơ", "Đồng Tháp", "Vĩnh Long"]


def test_no_recognisable_province_yields_empty():
    assert canon_provinces("Ban Giám Đốc Chi Nhánh Miền Nam") == []
    assert canon_provinces("Remote") == []
    assert canon_provinces("") == []
    assert canon_provinces(None) == []


def test_primary_and_clean_helpers():
    assert primary_province("Ho Chi Minh City, VN") == "Hồ Chí Minh"
    assert primary_province("Remote") is None
    assert clean_location("Hồ Chí Minh, Hồ Chí Minh") == "Hồ Chí Minh"
    assert clean_location("Remote") is None  # keep original upstream, don't blank
