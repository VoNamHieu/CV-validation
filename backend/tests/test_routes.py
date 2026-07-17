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


def _rate_limiter():
    """Reach the in-process RateLimitMiddleware instance to tweak/clear it."""
    from app.main import app, RateLimitMiddleware
    if app.middleware_stack is None:
        app.middleware_stack = app.build_middleware_stack()
    node = app.middleware_stack
    for _ in range(20):
        if node is None:
            break
        if isinstance(node, RateLimitMiddleware):
            return node
        node = getattr(node, "app", None)
    return None


class TestRateLimiting:
    def test_rate_limit_not_triggered_on_normal_use(self, client):
        """Normal usage should not trigger rate limit."""
        for _ in range(5):
            response = client.get("/health")
            assert response.status_code == 200

    def test_per_user_buckets_are_independent_on_shared_ip(self, client, monkeypatch):
        """The core fix: two authenticated users behind the SAME IP (as they are
        behind the Vercel egress) must get independent buckets — one heavy user
        must not 429 another. Keying is on the verified JWT sub, not the IP."""
        import app.services.auth as authmod
        monkeypatch.setattr(
            authmod, "verify_bearer_sub",
            lambda tok: {"tok-a": "user-a", "tok-b": "user-b"}.get(tok),
        )
        rl = _rate_limiter()
        assert rl is not None
        rl.clients.clear(); rl._token_subs.clear()
        monkeypatch.setattr(rl, "user_max", 3)

        def hit(tok):
            return client.get("/health", headers={"Authorization": f"Bearer {tok}"}).status_code

        # user-a exhausts its own budget…
        assert [hit("tok-a") for _ in range(5)] == [200, 200, 200, 429, 429]
        # …but user-b, same IP, is untouched.
        assert [hit("tok-b") for _ in range(3)] == [200, 200, 200]

    def test_invalid_token_cannot_mint_fresh_buckets(self, client, monkeypatch):
        """A present-but-invalid token falls back to the IP bucket, so a flood of
        distinct garbage tokens can't bypass the limit by minting new buckets."""
        import app.services.auth as authmod
        monkeypatch.setattr(authmod, "verify_bearer_sub", lambda tok: None)
        rl = _rate_limiter()
        rl.clients.clear(); rl._token_subs.clear()
        monkeypatch.setattr(rl, "ip_max", 2)

        codes = [
            client.get("/health", headers={"Authorization": f"Bearer junk-{i}"}).status_code
            for i in range(4)
        ]
        assert codes == [200, 200, 429, 429]

    def test_429_carries_retry_after(self, client, monkeypatch):
        rl = _rate_limiter()
        rl.clients.clear(); rl._token_subs.clear()
        monkeypatch.setattr(rl, "ip_max", 1)
        assert client.get("/health").status_code == 200
        blocked = client.get("/health")
        assert blocked.status_code == 429
        assert int(blocked.headers["Retry-After"]) >= 1
