import unittest
from uuid import UUID

from fastapi.testclient import TestClient

from main import app
from main import conversations
from providers.base import AIProviderError
from providers.fallback import UNCONFIGURED_PROVIDER_MESSAGE
from providers.fallback import UnconfiguredAIProvider
from routers.advisor import advisor_service
from routers.chat import chat_service


class FakeAIProvider:
    def generate_answer(self, message: str, assistant_profile: str) -> str:
        if assistant_profile == "emotional_advisor":
            return (
                '{"analysis":"Detecto tension y necesidad de limites claros.",'
                '"suggestions":['
                '"Entiendo como te sentis. Necesito que hablemos con respeto.",'
                '"Quiero resolver esto bien; podemos hablar en un rato con calma?",'
                '"Prefiero frenar aca y retomar cuando estemos mas tranquilos."'
                "]}"
            )
        return f"fake-ai: {message}"


class TestAPI(unittest.TestCase):
    def setUp(self):
        conversations.clear()
        self.original_chat_provider = chat_service._provider
        self.original_advisor_provider = advisor_service._provider
        chat_service._provider = FakeAIProvider()
        advisor_service._provider = FakeAIProvider()
        self.client = TestClient(app)

    def tearDown(self):
        chat_service._provider = self.original_chat_provider
        advisor_service._provider = self.original_advisor_provider

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

    def test_get_conversation_history(self):
        conversation_id = "conv-history"
        self.client.post(
            "/v1/chat",
            json={
                "conversation_id": conversation_id,
                "message": "hola",
                "channel": "web",
            },
        )

        response = self.client.get(f"/v1/conversations/{conversation_id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "conversation_id": conversation_id,
                "messages": [
                    {"role": "user", "message": "hola", "channel": "web"},
                    {
                        "role": "assistant",
                        "message": "fake-ai: hola",
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
            def generate_answer(self, message: str, assistant_profile: str) -> str:
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
            provider.generate_answer("hola", "general"),
            UNCONFIGURED_PROVIDER_MESSAGE,
        )

    def test_advisor_returns_analysis_and_suggestions(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: no me escuchas\nB: siento que me atacas",
                "context": "es un conflicto laboral",
                "tone": "empathetic",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["analysis"], "Detecto tension y necesidad de limites claros.")
        self.assertEqual(len(body["suggestions"]), 3)

    def test_advisor_validates_required_conversation_text(self):
        response = self.client.post(
            "/v1/advisor",
            json={"conversation_text": "", "context": "", "tone": "firm"},
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
