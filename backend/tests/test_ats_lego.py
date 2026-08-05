"""LEGO Workday adapter — the two things that make it not-generic.

Offline: the cxs API is stubbed with payloads shaped like the live tenant's
(no `locationsText`; location in `bulletFields`; one multi-country posting).
"""
import pytest

from app.services.ats_adapters import lego as L


def _posting(title, req, city="Tan Uyen, Binh Duong", slug="Tan-Uyen-Binh-Duong"):
    """A list row shaped like this tenant's: no `locationsText` at all."""
    return {"title": title, "externalPath": f"/job/{slug}/{title.replace(' ', '-')}_{req}",
            "bulletFields": [city, req]}


class _Resp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload


@pytest.fixture
def stub(monkeypatch):
    """Stub the cxs list + detail endpoints. `calls` records POST bodies so a
    test can assert which facet was applied."""
    state = {"calls": [], "list": {}, "detail": {}, "facets": []}

    def fake_post(url, headers=None, timeout=None, json=None):
        body = json or {}
        state["calls"].append(body)
        param = next(iter((body.get("appliedFacets") or {})), None)
        if param is None:  # the facet-discovery probe
            return _Resp({"total": 0, "jobPostings": [], "facets": state["facets"]})
        page = state["list"].get(param, [])[body.get("offset", 0):][:body.get("limit", 20)]
        return _Resp({"total": 0, "jobPostings": page})

    def fake_get(url, headers=None, timeout=None):
        for ext, info in state["detail"].items():
            if url.endswith(ext):
                return _Resp({"jobPostingInfo": info})
        return _Resp({}, status=404)

    monkeypatch.setattr(L.requests, "post", fake_post)
    monkeypatch.setattr(L.requests, "get", fake_get)
    return state


def test_matches_own_tenant_only():
    assert L._is_lego("https://lego.wd103.myworkdayjobs.com/LEGO_External")
    assert L._is_lego("https://lego.wd103.myworkdayjobs.com/en-US/LEGO_External")
    assert L._is_lego("https://lego.wd103.myworkdayjobs.com/")
    # per-job URL — the JD resolver routes those back through the listing
    assert L._is_lego("https://lego.wd103.myworkdayjobs.com/LEGO_External/job/"
                      "Tan-Uyen-Binh-Duong/Shipping-Intern_0000035266")
    # another site on the same tenant, and other Workday tenants, are not ours
    assert not L._is_lego("https://lego.wd103.myworkdayjobs.com/LEGO_Internal")
    assert not L._is_lego("https://mii.wd5.myworkdayjobs.com/MiTekVietnam")
    assert not L._is_lego("https://www.lego.com/careers")


def test_location_comes_from_bulletfields_not_locationstext(stub):
    """The regression this adapter exists for: with no `locationsText`, the
    generic Workday adapter's VN filter drops every posting."""
    stub["list"]["Location"] = [_posting("Shipping Intern", "0000035266")]
    stub["detail"]["Shipping-Intern_0000035266"] = {"jobDescription": "<p>Ship things.</p>"}

    jobs = L._lego("https://lego.wd103.myworkdayjobs.com/LEGO_External")

    assert len(jobs) == 1
    assert jobs[0]["location"] == "Tan Uyen, Binh Duong"
    assert jobs[0]["description"] == "Ship things."
    # externalPath is site-relative; the public URL needs the site segment
    assert jobs[0]["url"] == ("https://lego.wd103.myworkdayjobs.com/LEGO_External"
                             "/job/Tan-Uyen-Binh-Duong/Shipping-Intern_0000035266")


def test_foreign_primary_location_is_repaired_from_additional_locations(stub):
    """A req based abroad but also open in Vietnam matches the VN facet — keep
    it, but store the VN location, not the foreign primary city."""
    stub["list"]["Location"] = [
        _posting("Senior Legal Consultant", "0000034433", city="Shanghai", slug="Shanghai"),
    ]
    stub["detail"]["Senior-Legal-Consultant_0000034433"] = {
        "location": "Shanghai",
        "additionalLocations": ["Singapore", "Tan Uyen, Binh Duong"],
        "jobDescription": "Advise on contracts.",
    }

    jobs = L._lego("https://lego.wd103.myworkdayjobs.com/LEGO_External")

    assert len(jobs) == 1
    assert jobs[0]["location"] == "Tan Uyen, Binh Duong"


def test_posting_with_no_vietnam_location_anywhere_is_dropped(stub):
    stub["list"]["Location"] = [
        _posting("Store Manager", "0000099999", city="Shanghai", slug="Shanghai"),
    ]
    stub["detail"]["Store-Manager_0000099999"] = {
        "location": "Shanghai", "additionalLocations": ["Singapore"],
        "jobDescription": "Run a store.",
    }

    assert L._lego("https://lego.wd103.myworkdayjobs.com/LEGO_External") == []


def test_paginates_past_the_20_row_cap(stub):
    stub["list"]["Location"] = [_posting(f"Technician {i}", f"{i:07d}") for i in range(23)]

    jobs = L._lego("https://lego.wd103.myworkdayjobs.com/LEGO_External")

    assert len(jobs) == 23
    # page 2 comes back short (3 rows) → stop; `total` is never trusted
    assert [c["offset"] for c in stub["calls"]] == [0, 20]


def test_renamed_facet_is_rediscovered(stub):
    """Workday lets each tenant name this facet; a rename must not silently
    zero the board."""
    stub["list"]["Location_Country"] = [_posting("Maintenance Planner", "0000032378")]
    stub["facets"] = [{"facetParameter": "Location_Country",
                       "values": [{"descriptor": "Vietnam", "id": L._VN_COUNTRY_ID}]}]
    stub["detail"]["Maintenance-Planner_0000032378"] = {"jobDescription": "Plan maintenance."}

    jobs = L._lego("https://lego.wd103.myworkdayjobs.com/LEGO_External")

    assert len(jobs) == 1
    # pinned facet → empty, one discovery probe, then the rediscovered facet
    assert [next(iter(c.get("appliedFacets") or {}), None) for c in stub["calls"]] == [
        "Location", None, "Location_Country",
    ]


def test_registered_ahead_of_the_generic_workday_adapter():
    from app.services.ats_adapters.vendors import _ADAPTERS

    names = [n for n, _d, _f in _ADAPTERS]
    assert names.index("lego") < names.index("workday")
