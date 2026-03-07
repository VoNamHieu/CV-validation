"""Integration tests for API routes."""
import pytest


class TestRootAndHealth:
    def test_root_returns_message(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert "running" in response.json()["message"].lower()

    def test_health_returns_ok(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "service" in data


class TestExtractRoutes:
    def test_extract_cv_pdf_rejects_non_pdf(self, client):
        from io import BytesIO
        files = {"file": ("test.txt", BytesIO(b"hello"), "text/plain")}
        response = client.post("/extract/cv/pdf", files=files)
        assert response.status_code == 400
        assert "PDF" in response.json()["detail"]

    def test_extract_jd_pdf_rejects_non_pdf(self, client):
        from io import BytesIO
        files = {"file": ("test.docx", BytesIO(b"hello"), "application/msword")}
        response = client.post("/extract/jd/pdf", files=files)
        assert response.status_code == 400


class TestCrawlRoutes:
    def test_crawl_test_rejects_empty_urls(self, client):
        response = client.post("/crawl/test", json={"urls": []})
        assert response.status_code == 400

    def test_crawl_test_rejects_too_many_urls(self, client):
        urls = [f"https://example.com/{i}" for i in range(15)]
        response = client.post("/crawl/test", json={"urls": urls})
        assert response.status_code == 400

    def test_crawl_test_rejects_private_url(self, client):
        """SSRF protection: private IPs must be rejected."""
        response = client.post("/crawl/test", json={"urls": ["http://169.254.169.254/latest/meta-data/"]})
        assert response.status_code == 400

    def test_crawl_test_rejects_localhost(self, client):
        """SSRF protection: localhost must be rejected."""
        response = client.post("/crawl/test", json={"urls": ["http://localhost:8080"]})
        assert response.status_code == 400

    def test_smart_search_rejects_missing_url(self, client):
        response = client.post("/crawl/smart-search", json={"url": "", "search_keyword": ""})
        assert response.status_code == 400

    def test_smart_search_rejects_private_url(self, client):
        """SSRF protection on smart-search."""
        response = client.post("/crawl/smart-search", json={"url": "http://10.0.0.1", "search_keyword": "dev"})
        assert response.status_code == 400

    def test_fetch_page_rejects_missing_url(self, client):
        response = client.post("/crawl/fetch-page", json={"url": ""})
        assert response.status_code == 400

    def test_fetch_page_rejects_private_url(self, client):
        """SSRF protection on fetch-page."""
        response = client.post("/crawl/fetch-page", json={"url": "http://192.168.1.1"})
        assert response.status_code == 400


class TestRateLimiting:
    def test_rate_limit_not_triggered_on_normal_use(self, client):
        """Normal usage should not trigger rate limit."""
        for _ in range(5):
            response = client.get("/health")
            assert response.status_code == 200
