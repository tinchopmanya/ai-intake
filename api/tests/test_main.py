import unittest
from uuid import UUID

from fastapi.testclient import TestClient

from main import app
from main import conversations
from providers.base import AIProviderError
from providers.fallback import UNCONFIGURED_PROVIDER_MESSAGE
from providers.fallback import UnconfiguredAIProvider
from repositories.in_memory_persistence import persistence_store
from routers.advisor import advisor_service
from routers.chat import chat_service


class FakeAIProvider:
    def generate_answer(self, message: str) -> str:
        if "Responde EXCLUSIVAMENTE en JSON valido" in message:
            return (
                '{"analysis":"Hay tension emocional y necesidad de claridad.",'
                '"main_suggestion":"Entiendo lo que sentis y quiero hablarlo con calma.",'
                '"variants":['
                '{"tone":"empathetic","text":"Te escucho y me importa que podamos hablar bien."},'
                '{"tone":"firm","text":"Podemos hablar, pero necesito respeto en la conversacion."},'
                '{"tone":"brief","text":"Quiero hablarlo con calma y resolverlo."}'
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

    def test_advisor_returns_analysis_main_and_variants(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: Nunca me escuchas\nB: Me siento atacado",
                "context": "es mi ex",
                "tone": "empathetic",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["advisor_id"], "laura")
        self.assertEqual(body["advisor_name"], "Laura")
        self.assertIn("analysis", body)
        self.assertIn("main_suggestion", body)
        self.assertIn("variants", body)
        self.assertGreaterEqual(len(body["variants"]), 2)

    def test_advisor_resolution_uses_contact_priority(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: mensaje\nB: respuesta",
                "tone": "firm",
                "contact_id": "contact-colleague",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["advisor_id"], "robert")

    def test_advisor_resolution_uses_user_default_when_no_contact(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: mensaje\nB: respuesta",
                "tone": "brief",
                "user_id": "user-main",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["advisor_id"], "laura")

    def test_advisor_prompt_fallback_without_skills(self):
        class InspectProvider:
            def __init__(self):
                self.last_prompt = ""

            def generate_answer(self, message: str) -> str:
                self.last_prompt = message
                return (
                    '{"analysis":"ok",'
                    '"main_suggestion":"ok",'
                    '"variants":[{"tone":"empathetic","text":"ok1"},{"tone":"firm","text":"ok2"}]}'
                )

        no_skill_advisor_id = "no-skill"
        persistence_store.advisors[no_skill_advisor_id] = persistence_store.advisors["laura"].__class__(
            id=no_skill_advisor_id,
            name="NoSkill",
            role="Tester",
            description="Advisor sin skills",
            system_prompt_base="Prompt base sin skills.",
        )
        inspect_provider = InspectProvider()
        advisor_service._provider = inspect_provider

        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: hola\nB: chau",
                "advisor_id": no_skill_advisor_id,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Habilidades activas:", inspect_provider.last_prompt)
        persistence_store.advisors.pop(no_skill_advisor_id, None)

    def test_advisor_fallback_when_provider_fails(self):
        class BrokenProvider:
            def generate_answer(self, message: str) -> str:
                raise AIProviderError("boom")

        advisor_service._provider = BrokenProvider()
        response = self.client.post(
            "/v1/advisor",
            json={"conversation_text": "A: hola\nB: chau", "tone": "firm"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["advisor_id"], "laura")
        self.assertEqual(body["advisor_name"], "Laura")
        self.assertIn("analysis", body)
        self.assertIn("main_suggestion", body)
        self.assertEqual(len(body["variants"]), 3)


if __name__ == "__main__":
    unittest.main()
