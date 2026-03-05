"""Shared test fixtures."""
import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    """FastAPI test client for integration tests."""
    return TestClient(app)
