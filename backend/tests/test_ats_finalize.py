"""Regression tests for ats_adapters.core._finalize dedup keys."""
from app.services.ats_adapters.core import _finalize


def test_finalize_keeps_same_title_in_different_cities():
    jobs = [
        {"title": "Sales Executive", "url": "https://x.com/j/1", "location": "Hà Nội"},
        {"title": "Sales Executive", "url": "https://x.com/j/2", "location": "TP. Hồ Chí Minh"},
    ]
    assert len(_finalize(jobs)) == 2


def test_finalize_still_dedups_same_title_same_location():
    # accent-variant locations fold to the same key
    jobs = [
        {"title": "Sales Executive", "url": "https://x.com/a", "location": "Hà Nội"},
        {"title": "Sales Executive", "url": "https://x.com/b", "location": "Ha Noi"},
    ]
    assert len(_finalize(jobs)) == 1


def test_finalize_still_dedups_by_url():
    jobs = [
        {"title": "Backend Engineer", "url": "https://x.com/j/9", "location": "Hà Nội"},
        {"title": "Backend Engineer (Java)", "url": "https://x.com/j/9", "location": "Đà Nẵng"},
    ]
    assert len(_finalize(jobs)) == 1


def test_finalize_drops_fragment_on_bare_origin():
    # in-page anchors scraped as "jobs" (the LG/ServiceNow class)
    jobs = [
        {"title": "고객가치 실현을 위해", "url": "https://careers.lg.com#%EB%B0%B0", "location": ""},
        {"title": "AdobeMarketingChannel", "url": "https://careers.servicenow.com#AdobeMarketingChannel", "location": ""},
    ]
    assert _finalize(jobs) == []


def test_finalize_keeps_fragment_routed_spa_and_anchored_detail():
    jobs = [
        {"title": "Customer Service", "url": "https://hire-r1.mokahr.com/social-recruitment/klookcareers/1?locale=en#/job/2a46", "location": "HCM"},
        {"title": "CS KShip Hà Nội", "url": "https://about.kiotviet.vn/jobs/customer-service-kship-ha-noi/#apply-form", "location": "Hà Nội"},
    ]
    assert len(_finalize(jobs)) == 2


def test_finalize_normalizes_and_caps_description():
    from app.services.ats_adapters._shared import _MAX_DESC_CHARS
    jobs = [{"title": "Data Engineer", "url": "https://x.com/j/1", "location": "HN",
             "description": "Mô tả  công việc\n\n\n\n   \n\nYêu cầu:   3 năm" + "x" * 30000}]
    out = _finalize(jobs)
    d = out[0]["description"]
    assert "\n\n\n" not in d and "  " not in d.split("\n")[0]
    assert d.startswith("Mô tả công việc\n\nYêu cầu: 3 năm")
    assert len(d) == _MAX_DESC_CHARS
