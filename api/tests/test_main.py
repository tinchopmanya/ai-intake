import unittest
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.deps import get_ai_provider
from main import app
from main import conversations
from providers.base import AIProviderError
from providers.fallback import UNCONFIGURED_PROVIDER_MESSAGE
from providers.fallback import UnconfiguredAIProvider
from routers.chat import chat_service


class FakeProvider:
    def __init__(self) -> None:
        self.calls = 0

    def generate_answer(self, message: str) -> str:
        self.calls += 1
        if "SYSTEM:" in message and "responses" in message:
            return (
                '{"responses":['
                '{"advisor":"laura","text":"Podemos bajar la tension y resolverlo con calma."},'
                '{"advisor":"robert","text":"Confirmame horario exacto para organizarlo sin confusiones."},'
                '{"advisor":"lidia","text":"Confirmemos solo horario y lugar para evitar friccion."}'
                "]}"
            )
        return f"fake-ai: {message}"


class TestAPI(unittest.TestCase):
    def setUp(self):
        conversations.clear()
        self.original_chat_provider = chat_service._provider
        self.fake_provider = FakeProvider()
        chat_service._provider = self.fake_provider
        app.dependency_overrides.clear()
        app.dependency_overrides[get_ai_provider] = lambda: self.fake_provider
        self.client = TestClient(app)

    def tearDown(self):
        chat_service._provider = self.original_chat_provider
        app.dependency_overrides.clear()

    def test_health_ok(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_chat_with_defaults(self):
        response = self.client.post("/v1/chat", json={"message": "hola"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["answer"], "fake-ai: hola")
        self.assertIsInstance(body["conversation_id"], str)
        self.assertEqual(str(UUID(body["conversation_id"], version=4)), body["conversation_id"])
        self.assertIn(body["conversation_id"], conversations)

    def test_chat_with_conversation_id(self):
        response = self.client.post(
            "/v1/chat",
            json={
                "conversation_id": "conv-123",
                "message": "hello",
                "channel": "web",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "conversation_id": "conv-123",
                "answer": "fake-ai: hello",
            },
        )

    def test_generated_conversation_id_history(self):
        response = self.client.post("/v1/chat", json={"message": "first"})
        conversation_id = response.json()["conversation_id"]

        history_response = self.client.get(f"/v1/conversations/{conversation_id}")
        self.assertEqual(history_response.status_code, 200)
        self.assertEqual(
            history_response.json(),
            {
                "conversation_id": conversation_id,
                "messages": [
                    {"role": "user", "message": "first", "channel": "web"},
                    {
                        "role": "assistant",
                        "message": "fake-ai: first",
                        "channel": "assistant",
                    },
                ],
            },
        )

    def test_get_conversation_history_not_found(self):
        response = self.client.get("/v1/conversations/does-not-exist")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Conversation not found")

    def test_chat_fallback_when_provider_unavailable(self):
        class BrokenProvider:
            def generate_answer(self, message: str) -> str:
                raise AIProviderError("boom")

        chat_service._provider = BrokenProvider()
        with self.assertLogs("services.chat_service", level="ERROR") as captured_logs:
            response = self.client.post("/v1/chat", json={"message": "hola"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["answer"],
            "No pude generar una respuesta de IA en este momento. Intenta de nuevo.",
        )
        self.assertTrue(
            any("Failed to generate chat answer" in message for message in captured_logs.output)
        )

    def test_unconfigured_provider_message(self):
        provider = UnconfiguredAIProvider()
        self.assertEqual(
            provider.generate_answer("hola"),
            UNCONFIGURED_PROVIDER_MESSAGE,
        )

    def test_advisor_response_shape_mvp_contract(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "message_text": "Necesito responder un mensaje sensible",
                "mode": "reactive",
                "relationship_type": "familia",
                "context": {"user_id": "user-main"},
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("session_id", body)
        self.assertIn("responses", body)
        self.assertIn("persistence", body)
        self.assertNotIn("conversation_id", body)
        self.assertNotIn("results", body)
        self.assertEqual(len(body["responses"]), 3)

    def test_advisor_global_fallback_on_invalid_json(self):
        class InvalidProvider:
            def __init__(self):
                self.calls = 0

            def generate_answer(self, message: str) -> str:
                self.calls += 1
                return "respuesta no json"

        invalid_provider = InvalidProvider()
        app.dependency_overrides[get_ai_provider] = lambda: invalid_provider
        response = self.client.post(
            "/v1/advisor",
            json={
                "message_text": "Mensaje con conflicto",
                "mode": "reactive",
                "relationship_type": "familia",
                "context": {"user_id": "user-main"},
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["responses"]), 3)
        self.assertEqual(invalid_provider.calls, 1)

if __name__ == "__main__":
    unittest.main()
