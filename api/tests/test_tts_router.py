import unittest
from unittest.mock import patch
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.services.auth_service import AuthenticatedUser
from main import app


class _FakeCommunicate:
    last_text = ""
    last_voice = ""
    last_rate = ""
    last_pitch = ""

    def __init__(self, text: str, *, voice: str, rate: str, pitch: str) -> None:
        type(self).last_text = text
        type(self).last_voice = voice
        type(self).last_rate = rate
        type(self).last_pitch = pitch

    async def stream(self):
        yield {"type": "audio", "data": b"chunk-1"}
        yield {"type": "WordBoundary", "offset": 10}
        yield {"type": "audio", "data": b"chunk-2"}


class _BrokenCommunicate:
    def __init__(self, text: str, *, voice: str, rate: str, pitch: str) -> None:
        self.text = text

    async def stream(self):
        raise RuntimeError("edge down")
        yield {"type": "audio", "data": b""}


class TestTtsRouter(unittest.TestCase):
    def setUp(self) -> None:
        app.dependency_overrides.clear()
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id=UUID("00000000-0000-0000-0000-000000000401"),
            email="tts@example.com",
            name="TTS User",
            memory_opt_in=False,
            locale="es-UY",
            picture_url=None,
            country_code="UY",
            language_code="es",
            onboarding_completed=True,
        )
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_stream_endpoint_uses_default_voice_and_streams_audio(self) -> None:
        with patch("app.services.tts_service._HAS_EDGE_TTS", True), patch(
            "app.services.tts_service.edge_tts.Communicate",
            _FakeCommunicate,
        ):
            response = self.client.post(
                "/v1/tts/stream",
                json={"text": "Hola\ncomo estas porque necesito ordenar esto"},
                headers={"Accept-Language": "es-UY"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"chunk-1chunk-2")
        self.assertTrue(response.headers["content-type"].startswith("audio/mpeg"))
        self.assertEqual(response.headers["x-tts-voice"], "es-AR-ElenaNeural")
        self.assertEqual(_FakeCommunicate.last_voice, "es-AR-ElenaNeural")
        self.assertEqual(_FakeCommunicate.last_rate, "-10%")
        self.assertEqual(_FakeCommunicate.last_pitch, "+0Hz")
        self.assertTrue(_FakeCommunicate.last_text.endswith("."))
        self.assertIn(". ", _FakeCommunicate.last_text)

    def test_stream_endpoint_accepts_supported_voice_override(self) -> None:
        with patch("app.services.tts_service._HAS_EDGE_TTS", True), patch(
            "app.services.tts_service.edge_tts.Communicate",
            _FakeCommunicate,
        ):
            response = self.client.post(
                "/v1/tts/stream",
                json={"text": "Probando voz masculina", "voice": "es-ES-AlvaroNeural"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-tts-voice"], "es-ES-AlvaroNeural")
        self.assertEqual(_FakeCommunicate.last_voice, "es-ES-AlvaroNeural")

    def test_stream_endpoint_rejects_unsupported_voice(self) -> None:
        response = self.client.post(
            "/v1/tts/stream",
            json={"text": "Hola", "voice": "es-AR-UnknownNeural"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "unsupported_tts_voice")

    def test_stream_endpoint_maps_provider_failures(self) -> None:
        with patch("app.services.tts_service._HAS_EDGE_TTS", True), patch(
            "app.services.tts_service.edge_tts.Communicate",
            _BrokenCommunicate,
        ):
            response = self.client.post(
                "/v1/tts/stream",
                json={"text": "Hola"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "tts_unavailable")


if __name__ == "__main__":
    unittest.main()
