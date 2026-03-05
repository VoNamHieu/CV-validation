"""Tests for crawler service — pure utility functions."""
import json
import pytest
from app.services.crawler import (
    clean_html,
    extract_json_ld,
    parse_job_from_json_ld,
    detect_needs_playwright,
)


# ═══════════════════════════════════════════════════════════
# clean_html
# ═══════════════════════════════════════════════════════════

class TestCleanHtml:
    def test_strips_script_tags(self):
        html = "<html><body><script>alert('xss')</script><p>Hello</p></body></html>"
        result = clean_html(html)
        assert "alert" not in result
        assert "Hello" in result

    def test_strips_style_tags(self):
        html = "<html><body><style>body{color:red}</style><p>Content</p></body></html>"
        result = clean_html(html)
        assert "color:red" not in result
        assert "Content" in result

    def test_strips_nav_footer_header(self):
        html = """<html><body>
        <nav>Navigation</nav>
        <header>Header Content</header>
        <main><p>Main Content</p></main>
        <footer>Footer Content</footer>
        </body></html>"""
        result = clean_html(html)
        assert "Navigation" not in result
        assert "Header Content" not in result
        assert "Footer Content" not in result
        assert "Main Content" in result

    def test_strips_noise_classes(self):
        html = '<html><body><div class="sidebar">Sidebar</div><p>Main</p></body></html>'
        result = clean_html(html)
        assert "Sidebar" not in result
        assert "Main" in result

    def test_strips_aside_noscript_svg_iframe(self):
        html = """<html><body>
        <aside>Side</aside>
        <noscript>NoJS</noscript>
        <svg><rect/></svg>
        <iframe src="x"></iframe>
        <p>Real Content</p>
        </body></html>"""
        result = clean_html(html)
        assert "Real Content" in result
        assert "Side" not in result
        assert "NoJS" not in result

    def test_empty_html_returns_empty(self):
        assert clean_html("") == ""

    def test_collapses_whitespace(self):
        html = "<html><body><p>Hello    World</p></body></html>"
        result = clean_html(html)
        assert "Hello" in result
        assert "World" in result

    def test_preserves_text_content(self):
        html = """<html><body>
        <h1>Software Engineer</h1>
        <p>We are looking for a talented engineer.</p>
        <ul><li>Python</li><li>React</li></ul>
        </body></html>"""
        result = clean_html(html)
        assert "Software Engineer" in result
        assert "Python" in result
        assert "React" in result


# ═══════════════════════════════════════════════════════════
# extract_json_ld
# ═══════════════════════════════════════════════════════════

class TestExtractJsonLd:
    def test_finds_job_posting(self):
        ld_data = {"@type": "JobPosting", "title": "Dev", "description": "Build stuff"}
        html = f'<html><script type="application/ld+json">{json.dumps(ld_data)}</script></html>'
        result = extract_json_ld(html)
        assert result is not None
        assert result["title"] == "Dev"

    def test_returns_none_for_non_job_posting(self):
        ld_data = {"@type": "Organization", "name": "Acme"}
        html = f'<html><script type="application/ld+json">{json.dumps(ld_data)}</script></html>'
        result = extract_json_ld(html)
        assert result is None

    def test_handles_graph_array(self):
        ld_data = {"@graph": [
            {"@type": "WebPage", "name": "Page"},
            {"@type": "JobPosting", "title": "Manager", "description": "Lead team"},
        ]}
        html = f'<html><script type="application/ld+json">{json.dumps(ld_data)}</script></html>'
        result = extract_json_ld(html)
        assert result is not None
        assert result["title"] == "Manager"

    def test_handles_array_format(self):
        ld_data = [
            {"@type": "BreadcrumbList"},
            {"@type": "JobPosting", "title": "Designer"},
        ]
        html = f'<html><script type="application/ld+json">{json.dumps(ld_data)}</script></html>'
        result = extract_json_ld(html)
        assert result is not None
        assert result["title"] == "Designer"

    def test_handles_invalid_json(self):
        html = '<html><script type="application/ld+json">{broken json}</script></html>'
        result = extract_json_ld(html)
        assert result is None

    def test_handles_no_ld_json(self):
        html = "<html><body><p>No structured data</p></body></html>"
        result = extract_json_ld(html)
        assert result is None

    def test_handles_empty_html(self):
        result = extract_json_ld("")
        assert result is None


# ═══════════════════════════════════════════════════════════
# parse_job_from_json_ld
# ═══════════════════════════════════════════════════════════

class TestParseJobFromJsonLd:
    def test_extracts_basic_fields(self):
        data = {
            "title": "Software Engineer",
            "hiringOrganization": {"name": "Acme Corp"},
            "description": "Build software",
            "employmentType": "FULL_TIME",
            "datePosted": "2026-01-01",
        }
        result = parse_job_from_json_ld(data)
        assert result["title"] == "Software Engineer"
        assert result["company"] == "Acme Corp"
        assert result["employment_type"] == "FULL_TIME"
        assert result["source"] == "json_ld"

    def test_extracts_location_from_dict(self):
        data = {
            "title": "Dev",
            "jobLocation": {"address": {"addressLocality": "Ho Chi Minh"}},
            "description": "desc",
        }
        result = parse_job_from_json_ld(data)
        assert result["location"] == "Ho Chi Minh"

    def test_extracts_location_from_list(self):
        data = {
            "title": "Dev",
            "jobLocation": [{"address": {"addressLocality": "Hanoi"}}],
            "description": "desc",
        }
        result = parse_job_from_json_ld(data)
        assert result["location"] == "Hanoi"

    def test_truncates_long_description(self):
        data = {"title": "Dev", "description": "x" * 1000}
        result = parse_job_from_json_ld(data)
        assert len(result["description"]) <= 503  # 500 + "..."

    def test_handles_missing_fields(self):
        data = {"title": "Dev"}
        result = parse_job_from_json_ld(data)
        assert result["company"] == ""
        assert result["location"] == ""
        assert result["description"] == ""


# ═══════════════════════════════════════════════════════════
# detect_needs_playwright
# ═══════════════════════════════════════════════════════════

class TestDetectNeedsPlaywright:
    def test_detects_react(self):
        html = "<html>" + "x" * 3000 + "window.__reactFiber" + "</html>"
        assert detect_needs_playwright(html) is True

    def test_detects_angular(self):
        html = "<html>" + "x" * 3000 + "ng-version" + "</html>"
        assert detect_needs_playwright(html) is True

    def test_detects_nuxt(self):
        html = "<html>" + "x" * 3000 + "__nuxt__" + "</html>"
        assert detect_needs_playwright(html) is True

    def test_detects_next(self):
        html = "<html>" + "x" * 3000 + "__NEXT_DATA__" + "</html>"
        assert detect_needs_playwright(html) is True

    def test_short_html_needs_playwright(self):
        html = "<html><body>Short</body></html>"
        assert detect_needs_playwright(html) is True

    def test_static_html_does_not_need_playwright(self):
        html = "<html>" + "x" * 5000 + "<p>Normal static content</p></html>"
        assert detect_needs_playwright(html) is False

    def test_loading_text_needs_playwright(self):
        html = "<html>" + "x" * 3000 + "Loading..." + "</html>"
        assert detect_needs_playwright(html) is True
