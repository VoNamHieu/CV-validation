"""Tests for career_finder helpers (registrable-domain comparison)."""
import pytest

from app.services.career_finder import _registrable_domain, _same_site


class TestRegistrableDomain:
    def test_plain_com(self):
        assert _registrable_domain("acme.com") == "acme.com"

    def test_strips_www(self):
        assert _registrable_domain("www.acme.com") == "acme.com"

    def test_subdomain_collapses(self):
        assert _registrable_domain("careers.acme.com") == "acme.com"

    def test_com_vn_keeps_three_labels(self):
        assert _registrable_domain("fpt.com.vn") == "fpt.com.vn"

    def test_com_vn_subdomain(self):
        assert _registrable_domain("tuyendung.fpt.com.vn") == "fpt.com.vn"

    def test_co_uk(self):
        assert _registrable_domain("jobs.example.co.uk") == "example.co.uk"

    def test_bare_suffix(self):
        # Degenerate input: just the suffix itself.
        assert _registrable_domain("com.vn") == "com.vn"

    def test_empty(self):
        assert _registrable_domain("") == ""


class TestSameSite:
    def test_same_apex(self):
        assert _same_site("acme.com", "www.acme.com")

    def test_career_subdomain(self):
        assert _same_site("careers.acme.com", "acme.com")

    def test_different_com_vn_companies_are_not_same(self):
        # Regression: last-two-label comparison treated every *.com.vn pair
        # as the same site.
        assert not _same_site("fpt.com.vn", "evil.com.vn")

    def test_same_com_vn_company(self):
        assert _same_site("tuyendung.fpt.com.vn", "fpt.com.vn")

    def test_different_plain_domains(self):
        assert not _same_site("acme.com", "other.com")

    def test_empty_never_matches(self):
        assert not _same_site("", "")
