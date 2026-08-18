"""Which Workday posting URLs resolve to a CXS endpoint.

Workday publishes the same posting under two host shapes. Keying only on the
myworkdayjobs one silently sent every myworkdaysite posting (what Phenom-fronted
tenants like Mondelēz hand out as their applyUrl) to a generic SPA crawl, which
returns page chrome instead of the JD. Pure URL parsing — no network.
"""
import pytest

from app.services.jd_resolver import _workday_cxs_ref


@pytest.mark.parametrize("url,cxs", [
    # tenant in the host
    ("https://mdlz.wd3.myworkdayjobs.com/External/job/Ho-Chi-Minh/Intern_R-1",
     "https://mdlz.wd3.myworkdayjobs.com/wday/cxs/mdlz/External/job/Ho-Chi-Minh/Intern_R-1"),
    # …with a locale segment in front of the site
    ("https://aia.wd3.myworkdayjobs.com/en-US/External/job/Hanoi/Analyst_R-2",
     "https://aia.wd3.myworkdayjobs.com/wday/cxs/aia/External/job/Hanoi/Analyst_R-2"),
    # tenant in the PATH (myworkdaysite) — the shape that used to miss
    ("https://wd3.myworkdaysite.com/recruiting/mdlz/External/job/Ho-Chi-Minh-Vietnam/Demand-Planning-Intern_R-173704",
     "https://wd3.myworkdaysite.com/wday/cxs/mdlz/External/job/Ho-Chi-Minh-Vietnam/Demand-Planning-Intern_R-173704"),
])
def test_resolves_both_workday_host_shapes(url, cxs):
    ref = _workday_cxs_ref(url)
    assert ref is not None
    origin, tenant, site, ext = ref
    assert f"{origin}/wday/cxs/{tenant}/{site}{ext}" == cxs


@pytest.mark.parametrize("url", [
    "https://mdlz.wd3.myworkdayjobs.com/External",              # board, not a posting
    "https://jobs.smartrecruiters.com/Acme/12345",              # another ATS
    "https://wd3.myworkdaysite.com/recruiting/mdlz/External",    # no /job/ segment
    "",
])
def test_ignores_non_workday_postings(url):
    assert _workday_cxs_ref(url) is None
