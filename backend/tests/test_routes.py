"""Integration tests for API routes."""
import pytest
from unittest.mock import patch, AsyncMock
from app.models.schemas import CVSchema, JDSchema, MatchResultSchema, CategoryScore


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


class TestAIRoutes:
    @patch("app.routers.process.extract_cv_structured", new_callable=AsyncMock)
    def test_extract_cv_success(self, mock_extract, client):
        mock_extract.return_value = CVSchema(
            name="John", summary="Dev", skills=["Python"]
        )
        response = client.post("/ai/extract-cv", json={"raw_text": "Some CV text here"})
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "John"
        assert "Python" in data["skills"]

    @patch("app.routers.process.extract_cv_structured", new_callable=AsyncMock)
    def test_extract_cv_handles_error(self, mock_extract, client):
        mock_extract.side_effect = Exception("AI service down")
        response = client.post("/ai/extract-cv", json={"raw_text": "text"})
        assert response.status_code == 500

    @patch("app.routers.process.extract_jd_structured", new_callable=AsyncMock)
    def test_extract_jd_success(self, mock_extract, client):
        mock_extract.return_value = JDSchema(
            must_have=["Python", "FastAPI"],
            responsibilities=["Build APIs"],
            seniority_expected="Senior",
            domain="Fintech",
        )
        response = client.post("/ai/extract-jd", json={"raw_text": "JD text"})
        assert response.status_code == 200
        assert "Python" in response.json()["must_have"]

    @patch("app.routers.process.calculate_job_fit", new_callable=AsyncMock)
    def test_score_success(self, mock_score, client):
        cat = CategoryScore(score=80, reasoning="Good", gaps=[])
        mock_score.return_value = MatchResultSchema(
            overall_score=78,
            must_have_match=cat,
            experience_match=cat,
            domain_match=cat,
            seniority_match=cat,
            nice_to_have_match=cat,
            strength_summary="Strong",
        )
        cv = CVSchema(name="Test", skills=["Python"]).model_dump()
        jd = JDSchema(must_have=["Python"]).model_dump()
        response = client.post("/ai/score", json={"cv": cv, "jd": jd})
        assert response.status_code == 200
        assert response.json()["overall_score"] == 78

    @patch("app.routers.process.optimize_cv", new_callable=AsyncMock)
    def test_optimize_success(self, mock_optimize, client):
        mock_optimize.return_value = CVSchema(
            name="Test", summary="Optimized summary", skills=["Python"]
        )
        cat = CategoryScore(score=70, reasoning="OK", gaps=[]).model_dump()
        cv = CVSchema(name="Test", skills=["Python"]).model_dump()
        jd = JDSchema(must_have=["Python"]).model_dump()
        match = MatchResultSchema(
            overall_score=70,
            must_have_match=cat,
            experience_match=cat,
            domain_match=cat,
            seniority_match=cat,
            nice_to_have_match=cat,
            strength_summary="OK",
        ).model_dump()
        response = client.post("/ai/optimize", json={"cv": cv, "jd": jd, "match": match})
        assert response.status_code == 200
        assert "Optimized" in response.json()["summary"]


class TestCrawlRoutes:
    def test_crawl_test_rejects_empty_urls(self, client):
        response = client.post("/crawl/test", json={"urls": []})
        assert response.status_code == 400

    def test_crawl_test_rejects_too_many_urls(self, client):
        urls = [f"https://example.com/{i}" for i in range(15)]
        response = client.post("/crawl/test", json={"urls": urls})
        assert response.status_code == 400

    def test_smart_search_rejects_missing_url(self, client):
        response = client.post("/crawl/smart-search", json={"url": "", "search_keyword": ""})
        assert response.status_code == 400

    def test_fetch_page_rejects_missing_url(self, client):
        response = client.post("/crawl/fetch-page", json={"url": ""})
        assert response.status_code == 400


class TestRateLimiting:
    def test_rate_limit_not_triggered_on_normal_use(self, client):
        """Normal usage should not trigger rate limit."""
        for _ in range(5):
            response = client.get("/health")
            assert response.status_code == 200
