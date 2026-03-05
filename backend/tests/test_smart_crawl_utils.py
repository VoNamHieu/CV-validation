"""Tests for smart_crawl utility functions — link extraction and heuristics."""
import pytest
from app.routers.smart_crawl import extract_candidate_links, _heuristic_job_links


class TestExtractCandidateLinks:
    def _make_html(self, links: list[tuple[str, str]]) -> str:
        anchors = "\n".join(f'<a href="{url}">{text}</a>' for url, text in links)
        return f"<html><body>{anchors}</body></html>"

    def test_extracts_same_domain_links(self):
        html = self._make_html([
            ("https://example.com/job/123", "Software Engineer"),
            ("https://example.com/job/456", "Product Manager"),
        ])
        result = extract_candidate_links(html, "example.com")
        assert len(result) == 2
        assert result[0]["url"] == "https://example.com/job/123"
        assert result[0]["text"] == "Software Engineer"

    def test_filters_external_domains(self):
        html = self._make_html([
            ("https://example.com/job/123", "Our Job"),
            ("https://facebook.com/share", "Share"),
            ("https://google.com/search", "Search"),
        ])
        result = extract_candidate_links(html, "example.com")
        assert len(result) == 1

    def test_skips_login_about_pages(self):
        html = self._make_html([
            ("https://example.com/job/123", "Real Job"),
            ("https://example.com/login", "Login"),
            ("https://example.com/about", "About Us"),
            ("https://example.com/register", "Register"),
        ])
        result = extract_candidate_links(html, "example.com")
        assert len(result) == 1
        assert result[0]["text"] == "Real Job"

    def test_makes_relative_urls_absolute(self):
        html = '<html><body><a href="/job/789">Backend Dev</a></body></html>'
        result = extract_candidate_links(html, "example.com")
        assert len(result) == 1
        assert result[0]["url"] == "https://example.com/job/789"

    def test_deduplicates_urls(self):
        html = self._make_html([
            ("https://example.com/job/123", "Job A"),
            ("https://example.com/job/123", "Job A duplicate"),
        ])
        result = extract_candidate_links(html, "example.com")
        assert len(result) == 1

    def test_skips_short_paths(self):
        html = self._make_html([
            ("https://example.com/", "Home"),
            ("https://example.com/a", "Too Short"),
            ("https://example.com/job/long-enough-path", "Valid"),
        ])
        result = extract_candidate_links(html, "example.com")
        assert len(result) == 1

    def test_caps_at_100_links(self):
        links = [(f"https://example.com/job/{i}", f"Job {i}") for i in range(150)]
        html = self._make_html(links)
        result = extract_candidate_links(html, "example.com")
        assert len(result) <= 100

    def test_empty_html_returns_empty(self):
        result = extract_candidate_links("", "example.com")
        assert result == []

    def test_generates_text_from_slug_when_text_empty(self):
        html = '<html><body><a href="https://example.com/viec-lam/python-developer-12345"></a></body></html>'
        result = extract_candidate_links(html, "example.com")
        assert len(result) == 1
        assert result[0]["text"] != ""  # Should derive from slug

    def test_skips_social_media_links(self):
        html = self._make_html([
            ("https://linkedin.com/share?url=x", "Share on LinkedIn"),
            ("https://twitter.com/intent/tweet", "Tweet"),
            ("https://example.com/job/real-job", "Real Job"),
        ])
        result = extract_candidate_links(html, "example.com")
        assert len(result) == 1


class TestHeuristicJobLinks:
    def _make_candidates(self, urls: list[str]) -> list[dict]:
        return [{"url": url, "text": f"Job {i}"} for i, url in enumerate(urls)]

    def test_matches_vietnamworks_pattern(self):
        candidates = self._make_candidates([
            "https://www.vietnamworks.com/senior-python-developer-12345-jv",
            "https://www.vietnamworks.com/about",
        ])
        result = _heuristic_job_links(candidates, "vietnamworks.com")
        assert len(result) == 1
        assert "12345-jv" in result[0]

    def test_matches_topcv_pattern(self):
        candidates = self._make_candidates([
            "https://www.topcv.vn/viec-lam/frontend-developer-67890",
        ])
        result = _heuristic_job_links(candidates, "topcv.vn")
        assert len(result) == 1

    def test_matches_generic_job_pattern(self):
        candidates = self._make_candidates([
            "https://example.com/jobs/software-engineer-99999",
            "https://example.com/about",
        ])
        result = _heuristic_job_links(candidates, "example.com")
        assert len(result) == 1

    def test_matches_careerbuilder_pattern(self):
        candidates = self._make_candidates([
            "https://careerbuilder.vn/viec-lam/python-dev.html",
        ])
        result = _heuristic_job_links(candidates, "careerbuilder.vn")
        assert len(result) == 1

    def test_matches_linkedin_pattern(self):
        candidates = self._make_candidates([
            "https://linkedin.com/jobs/view/123456789",
        ])
        result = _heuristic_job_links(candidates, "linkedin.com")
        assert len(result) == 1

    def test_caps_at_20(self):
        candidates = self._make_candidates(
            [f"https://example.com/jobs/job-{10000+i}" for i in range(30)]
        )
        result = _heuristic_job_links(candidates, "example.com")
        assert len(result) <= 20

    def test_empty_candidates_returns_empty(self):
        result = _heuristic_job_links([], "example.com")
        assert result == []
