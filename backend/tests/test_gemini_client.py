"""Tests for shared Gemini client — overload detection and fallback logic."""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from app.services.gemini_client import is_overloaded, call_with_fallback, MODELS_PRO


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


class TestCallWithFallback:
    @pytest.mark.asyncio
    async def test_returns_first_successful_model(self):
        mock_result = MagicMock()
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_result)

        with patch("app.services.gemini_client.get_instructor_client", return_value=mock_client):
            result = await call_with_fallback(
                response_model=MagicMock,
                messages=[{"role": "user", "content": "test"}],
                models=["model-a", "model-b"],
            )
        assert result == mock_result
        mock_client.chat.completions.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_falls_back_on_overload(self):
        mock_result = MagicMock()
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=[
                Exception("503 Service Unavailable"),
                mock_result,
            ]
        )

        with patch("app.services.gemini_client.get_instructor_client", return_value=mock_client):
            result = await call_with_fallback(
                response_model=MagicMock,
                messages=[{"role": "user", "content": "test"}],
                models=["model-a", "model-b"],
            )
        assert result == mock_result
        assert mock_client.chat.completions.create.call_count == 2

    @pytest.mark.asyncio
    async def test_raises_non_overload_error(self):
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=Exception("Invalid API key")
        )

        with patch("app.services.gemini_client.get_instructor_client", return_value=mock_client):
            with pytest.raises(Exception, match="Invalid API key"):
                await call_with_fallback(
                    response_model=MagicMock,
                    messages=[{"role": "user", "content": "test"}],
                    models=["model-a"],
                )

    @pytest.mark.asyncio
    async def test_raises_last_error_when_all_overloaded(self):
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=[
                Exception("503 unavailable"),
                Exception("503 unavailable"),
                Exception("503 unavailable"),
            ]
        )

        with patch("app.services.gemini_client.get_instructor_client", return_value=mock_client):
            with pytest.raises(Exception, match="503 unavailable"):
                await call_with_fallback(
                    response_model=MagicMock,
                    messages=[{"role": "user", "content": "test"}],
                    models=["a", "b", "c"],
                )

    @pytest.mark.asyncio
    async def test_uses_default_models_when_none(self):
        mock_result = MagicMock()
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_result)

        with patch("app.services.gemini_client.get_instructor_client", return_value=mock_client):
            await call_with_fallback(
                response_model=MagicMock,
                messages=[{"role": "user", "content": "test"}],
            )
        call_args = mock_client.chat.completions.create.call_args
        assert call_args.kwargs["model"] == MODELS_PRO[0]
