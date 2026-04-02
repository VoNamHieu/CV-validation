"""Tests for shared OpenAI client — overload detection."""
import pytest
from app.services.openai_client import is_overloaded


class TestIsOverloaded:
    def test_detects_503(self):
        assert is_overloaded(Exception("HTTP 503 Service Unavailable")) is True

    def test_detects_unavailable(self):
        assert is_overloaded(Exception("Model is currently unavailable")) is True

    def test_detects_overloaded(self):
        assert is_overloaded(Exception("Server overloaded, try later")) is True

    def test_detects_resource_exhausted(self):
        assert is_overloaded(Exception("RESOURCE_EXHAUSTED: quota exceeded")) is True

    def test_detects_quota(self):
        assert is_overloaded(Exception("Quota limit reached")) is True

    def test_non_overload_error(self):
        assert is_overloaded(Exception("Invalid API key")) is False

    def test_general_error(self):
        assert is_overloaded(Exception("Connection refused")) is False

    def test_case_insensitive(self):
        assert is_overloaded(Exception("UNAVAILABLE")) is True
        assert is_overloaded(Exception("Overloaded")) is True
