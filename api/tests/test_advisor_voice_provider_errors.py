import io
import unittest
from unittest.mock import patch
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.deps import get_ai_provider
from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.services.auth_service import AuthenticatedUser
from main import app
from providers.base import AIProviderError
from providers.gemini import GeminiAIProvider


class _FakeGeminiResponse:
    def __init__(self, body: str) -> None:
        self._body = body.encode("utf-8")

    def __enter__(self) -> "_FakeGeminiResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def read(self) -> bytes:
        return self._body


def _build_http_error(*, code: int, body: str):
    from urllib.error import HTTPError

    return HTTPError(
        url="https://generativelanguage.googleapis.com/test",
        code=code,
        msg="error",
        hdrs=None,
        fp=io.BytesIO(body.encode("utf-8")),
    )


class _UnavailableVoiceProvider:
    def generate_answer(self, message: str) -> str:
        raise AIProviderError(
            "Service unavailable",
            status_code=503,
            provider_code="UNAVAILABLE",
            retryable=True,
            provider_name="gemini",
            model="gemini-primary",
        )


class TestGeminiProviderRetry(unittest.TestCase):
    def test_retries_unavailable_up_to_third_attempt(self) -> None:
        provider = GeminiAIProvider(
            api_key="test-key",
            model="gemini-primary",
            timeout_seconds=1,
        )
        unavailable_error = _build_http_error(
            code=503,
            body='{"error":{"code":503,"message":"busy","status":"UNAVAILABLE"}}',
        )
        success_response = _FakeGeminiResponse(
            '{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}'
        )

        with patch(
            "providers.gemini.request.urlopen",
            side_effect=[unavailable_error, unavailable_error, success_response],
        ) as mocked_urlopen, patch("providers.gemini.time.sleep") as mocked_sleep, self.assertLogs(
            "providers.gemini",
            level="INFO",
        ) as captured_logs:
            result = provider.generate_answer("hola")

        self.assertEqual(result, "ok")
        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertEqual(mocked_sleep.call_count, 2)
        self.assertTrue(any("attempt=1/3 status_code=503" in message for message in captured_logs.output))
        self.assertTrue(any("attempt=2/3 status_code=503" in message for message in captured_logs.output))

    def test_uses_fallback_model_after_primary_retries_are_exhausted(self) -> None:
        provider = GeminiAIProvider(
            api_key="test-key",
            model="gemini-primary",
            fallback_model="gemini-backup",
            timeout_seconds=1,
        )
        call_urls: list[str] = []

        def fake_urlopen(req, timeout):  # type: ignore[no-untyped-def]
            call_urls.append(req.full_url)
            if "gemini-primary" in req.full_url:
                raise _build_http_error(
                    code=503,
                    body='{"error":{"code":503,"message":"busy","status":"UNAVAILABLE"}}',
                )
            return _FakeGeminiResponse('{"candidates":[{"content":{"parts":[{"text":"fallback"}]}}]}')

        with patch("providers.gemini.request.urlopen", side_effect=fake_urlopen), patch(
            "providers.gemini.time.sleep"
        ), self.assertLogs("providers.gemini", level="WARNING") as captured_logs:
            result = provider.generate_answer("hola")

        self.assertEqual(result, "fallback")
        self.assertEqual(len(call_urls), 4)
        self.assertTrue(all("gemini-primary" in url for url in call_urls[:3]))
        self.assertIn("gemini-backup", call_urls[3])
        self.assertTrue(any("gemini_fallback_start" in message for message in captured_logs.output))


class TestAdvisorVoiceProviderMapping(unittest.TestCase):
    def setUp(self) -> None:
        app.dependency_overrides.clear()
        app.dependency_overrides[get_ai_provider] = lambda: _UnavailableVoiceProvider()
        app.dependency_overrides[get_uow] = lambda: None
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id=UUID("00000000-0000-0000-0000-000000000201"),
            email="voice@example.com",
            name="Voice User",
            memory_opt_in=False,
            locale="es-LA",
            picture_url=None,
            country_code="UY",
            language_code="es",
            onboarding_completed=False,
        )
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_voice_endpoint_maps_provider_unavailable_to_http_503(self) -> None:
        response = self.client.post(
            "/v1/advisor/voice",
            headers={"Accept-Language": "es-UY"},
            data={
                "advisor_id": "laura",
                "entry_mode": "advisor_conversation",
                "transcript": "Hola",
                "messages_json": '[{"role":"user","content":"Hola"}]',
            },
            files={"audio": ("voice.webm", b"audio", "audio/webm")},
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "advisor_ai_high_demand")
        self.assertEqual(
            response.json()["message"],
            "El servicio de IA está con alta demanda. Probá nuevamente en unos segundos.",
        )


if __name__ == "__main__":
    unittest.main()
