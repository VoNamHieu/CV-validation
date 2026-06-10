"""Tests for SSRF URL validation (B1)."""
import pytest
from app.services.url_validator import is_allowed_url


class TestIsAllowedUrl:
    """Mirrors frontend validation.test.ts — must pass all the same cases."""

    # ── Should ALLOW ──
    def test_allows_normal_http(self):
        assert is_allowed_url("http://example.com") is True

    def test_allows_normal_https(self):
        assert is_allowed_url("https://www.google.com/search?q=test") is True

    def test_allows_vietnamese_job_sites(self):
        assert is_allowed_url("https://www.vietnamworks.com/viec-lam/developer") is True
        assert is_allowed_url("https://www.topcv.vn/viec-lam/python-dev") is True

    def test_allows_linkedin(self):
        assert is_allowed_url("https://www.linkedin.com/jobs/view/123456") is True

    # ── Should BLOCK ──
    def test_blocks_localhost(self):
        assert is_allowed_url("http://localhost:8080") is False

    def test_blocks_127(self):
        assert is_allowed_url("http://127.0.0.1:3000") is False

    def test_blocks_0000(self):
        assert is_allowed_url("http://0.0.0.0:8000") is False

    def test_blocks_ipv6_loopback(self):
        assert is_allowed_url("http://[::1]:8080") is False

    def test_blocks_private_10(self):
        assert is_allowed_url("http://10.0.0.1") is False

    def test_blocks_private_192(self):
        assert is_allowed_url("http://192.168.1.1") is False

    def test_blocks_private_172(self):
        assert is_allowed_url("http://172.16.0.1") is False
        assert is_allowed_url("http://172.31.255.255") is False

    def test_blocks_aws_metadata(self):
        assert is_allowed_url("http://169.254.169.254/latest/meta-data/") is False

    def test_blocks_gcp_metadata(self):
        assert is_allowed_url("http://metadata.google.internal") is False

    def test_blocks_integer_encoded_loopback(self):
        # http://2130706433 == http://127.0.0.1 — classic SSRF bypass
        assert is_allowed_url("http://2130706433/latest/meta-data/") is False

    def test_blocks_internal_domains(self):
        assert is_allowed_url("http://service.internal") is False

    def test_blocks_local_domains(self):
        assert is_allowed_url("http://myservice.local") is False

    def test_blocks_localhost_domains(self):
        assert is_allowed_url("http://app.localhost") is False

    def test_blocks_ftp(self):
        assert is_allowed_url("ftp://example.com/file.txt") is False

    def test_blocks_file(self):
        assert is_allowed_url("file:///etc/passwd") is False

    def test_blocks_empty(self):
        assert is_allowed_url("") is False

    def test_blocks_invalid(self):
        assert is_allowed_url("not-a-url") is False

    def test_blocks_javascript(self):
        assert is_allowed_url("javascript:alert(1)") is False
