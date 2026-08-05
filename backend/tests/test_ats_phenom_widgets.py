"""Phenom's two generations: the ph-services JSON API, and the /widgets
refineSearch API that replaced it on newer tenants (BCG, Mastercard, ABB).

Offline: both endpoints are stubbed. The point of these tests is the ROUTING —
a tenant must not lose its jobs to the wrong endpoint, and a tenant whose
services API works must not pay for a second round-trip.
"""
import pytest

from app.services.ats_adapters import platforms as P


class _Resp:
    def __init__(self, payload, status=200, text=None):
        self._payload = payload
        self.status_code = status
        self.text = text or ""

    def json(self):
        if self._payload is None:      # the HTML shell newer tenants return
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return self._payload


def _widget_job(title, jid, country="Vietnam", city="Hồ Chí Minh", **extra):
    return {"title": title, "jobId": jid, "country": country, "city": city, **extra}


@pytest.fixture
def phenom(monkeypatch):
    """Stub both Phenom endpoints. `services=None` means "answers with HTML"."""
    state = {"services": None, "widgets": [], "hits": []}

    def fake_post(url, headers=None, timeout=None, json=None):
        body = json or {}
        state["hits"].append(url)
        if url.endswith("/services/jobs/search/"):
            if state["services"] is None:
                return _Resp(None, text="<!DOCTYPE html>")
            page = state["services"][body.get("startrow", 0):][:body.get("recordsperpage", 100)]
            return _Resp({"jobList": page})
        if url.endswith("/widgets"):
            rows = state["widgets"]
            page = rows[body.get("from", 0):][:body.get("size", 100)]
            return _Resp({"refineSearch": {"totalHits": len(rows), "data": {"jobs": page}}})
        raise AssertionError(f"unexpected POST {url}")

    monkeypatch.setattr(P.requests, "post", fake_post)
    return state


def test_services_tenant_is_untouched_and_never_calls_widgets(phenom):
    """Vietcombank/Techcombank/Nestlé shape — the old API answers, so nothing
    about their path may change."""
    phenom["services"] = [{"title": "Chuyên viên QLRR", "location": "Hà Nội, VN",
                           "urltitle": "chuyen-vien-qlrr", "id": "12345"}]

    jobs = P._phenom_services("https://tuyendung.vietcombank.com.vn/search-results")

    assert len(jobs) == 1
    assert jobs[0]["url"] == "https://tuyendung.vietcombank.com.vn/job/chuyen-vien-qlrr/12345/"
    assert not any(h.endswith("/widgets") for h in phenom["hits"])


def test_working_services_api_with_no_vn_jobs_does_not_fall_back(phenom):
    """"API works, no VN jobs" is a real answer — only "no such API" earns a
    second round-trip."""
    phenom["services"] = [{"title": "Analyst", "location": "Zurich, CH",
                           "urltitle": "analyst", "id": "9"}]
    phenom["widgets"] = [_widget_job("Should Not Appear", "X1")]

    assert P._phenom_services("https://jobdetails.nestle.com/search-results") == []
    assert not any(h.endswith("/widgets") for h in phenom["hits"])


def test_html_shell_falls_back_to_widgets(phenom):
    """BCG/Mastercard/ABB shape — /services returns the SPA's HTML, so the job
    list has to come from /widgets."""
    phenom["widgets"] = [_widget_job("Business Analyst, Vietnam", "58043",
                                     location="Hồ Chí Minh, Vietnam")]

    jobs = P._phenom_services("https://careers.bcg.com/global/en/search-results")

    assert len(jobs) == 1
    assert jobs[0]["url"] == ("https://careers.bcg.com/global/en/job/58043/"
                              "business-analyst-vietnam")
    assert jobs[0]["location"] == "Hồ Chí Minh, Vietnam"
    # left empty on purpose: a ~300-char teaser would satisfy resolve_full_jd and
    # block the real JSON-LD JobPosting on the job page
    assert jobs[0]["description"] == ""


def test_soft_country_filter_leakage_is_dropped(phenom):
    """`selected_fields.country` only BOOSTS Vietnam — BCG returns Malaysia and
    Singapore rows alongside it."""
    phenom["widgets"] = [
        _widget_job("Associate, Vietnam", "58587"),
        _widget_job("Project Leader", "56194", country="Malaysia", city="Kuala Lumpur"),
        _widget_job("Lead IT Architect", "56501", country="Singapore", city="Singapore"),
    ]

    jobs = P._phenom_services("https://careers.bcg.com/global/en/search-results")

    assert [j["title"] for j in jobs] == ["Associate, Vietnam"]


def test_location_falls_back_across_the_keys_tenants_actually_fill(phenom):
    """DHL/ABB fill cityState; BCG leaves it null and fills location."""
    phenom["widgets"] = [
        _widget_job("With cityState", "A1", cityState="Ho Chi Minh City, Hồ Chí Minh"),
        _widget_job("With location", "A2", location="Hồ Chí Minh, Vietnam"),
        _widget_job("City only", "A3", city="Hà Nội"),
    ]

    locs = [j["location"] for j in P._phenom_services("https://careers.abb/global/en/search-results")]

    assert locs == ["Ho Chi Minh City, Hồ Chí Minh", "Hồ Chí Minh, Vietnam", "Hà Nội"]


def test_untagged_country_still_judged_by_its_location(phenom):
    phenom["widgets"] = [
        _widget_job("No country tag, VN city", "B1", country="", city="Đà Nẵng"),
        _widget_job("No country tag, foreign", "B2", country="", city="Zurich"),
    ]

    jobs = P._phenom_services("https://careers.bcg.com/global/en/search-results")

    assert [j["title"] for j in jobs] == ["No country tag, VN city"]


@pytest.mark.parametrize("career_url,expected", [
    ("https://careers.bcg.com/global/en/search-results", "global/en"),
    ("https://careers.mastercard.com/us/en/search-results", "us/en"),
    ("https://careers.abb/global/en/search-results?qcountry=Vietnam", "global/en"),
    ("https://jobdetails.nestle.com/search-results", "global/en"),   # no locale → default
])
def test_detail_locale_comes_from_the_career_url(career_url, expected):
    assert P._phenom_locale(career_url) == expected


def test_widgets_pagination_stops_at_total(phenom):
    phenom["widgets"] = [_widget_job(f"Role {i}", f"J{i}") for i in range(120)]

    jobs = P._phenom_services("https://careers.bcg.com/global/en/search-results")

    assert len(jobs) == 120
    assert [h for h in phenom["hits"] if h.endswith("/widgets")] == [
        "https://careers.bcg.com/widgets"] * 2       # 100 + 20, then stop
