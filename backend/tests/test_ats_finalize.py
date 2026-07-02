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
