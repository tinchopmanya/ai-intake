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


class FakeCommitteeProvider:
    def __init__(self) -> None:
        self.calls = 0
        self.last_prompt = ""

    def generate_answer(self, message: str) -> str:
        self.calls += 1
        self.last_prompt = message
        if "FORMATO DE RESPUESTA (JSON estricto" in message:
            return (
                '{"analysis":"Hay tension y necesidad de limites claros.",'
                '"results":['
                '{"advisor_id":"laura","advisor_name":"Laura","suggestions":['
                '"Entiendo como te sentis. Quiero hablarlo con calma.",'
                '"Me importa que nos escuchemos sin atacarnos."'
                "]},"
                '{"advisor_id":"robert","advisor_name":"Robert","suggestions":['
                '"Podemos hablar, pero necesito respeto.",'
                '"Voy a sostener mis limites con claridad."'
                "]},"
                '{"advisor_id":"lidia","advisor_name":"Lidia","suggestions":['
                '"Propongo pausar, ordenar ideas y responder con foco."'
                "]}"
                "]}"
            )
        return f"fake-ai: {message}"


class TestAPI(unittest.TestCase):
    def setUp(self):
        conversations.clear()
        persistence_store.advisor_outputs.clear()
        persistence_store.messages.clear()
        persistence_store.conversations.clear()
        self.original_chat_provider = chat_service._provider
        self.original_advisor_provider = advisor_service._provider
        self.fake_committee_provider = FakeCommitteeProvider()
        chat_service._provider = self.fake_committee_provider
        advisor_service._provider = self.fake_committee_provider
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

    def test_advisor_committee_response_shape(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: Nunca me escuchas\nB: Siento que me atacas",
                "context": "es una relacion sensible",
                "user_id": "user-main",
                "contact_id": "contact-ex",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("analysis", body)
        self.assertIn("results", body)
        self.assertIn("conversation_id", body)
        self.assertIn("contact_resolution", body)
        self.assertNotIn("main_suggestion", body)
        self.assertNotIn("variants", body)
        self.assertNotIn("advisor_id", body)
        self.assertNotIn("advisor_name", body)
        self.assertGreaterEqual(len(body["results"]), 1)
        self.assertEqual(self.fake_committee_provider.calls, 1)

    def test_advisor_generates_conversation_id_if_missing(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: hola\nB: chau",
                "user_id": "user-main",
            },
        )
        self.assertEqual(response.status_code, 200)
        conversation_id = response.json()["conversation_id"]
        self.assertIsInstance(conversation_id, str)
        self.assertTrue(conversation_id)
        self.assertIn(conversation_id, persistence_store.conversations)

    def test_advisor_reuses_conversation_id_if_provided(self):
        conversation_id = "advisor-conv-123"
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_id": conversation_id,
                "conversation_text": "A: hola\nB: chau",
                "user_id": "user-main",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["conversation_id"], conversation_id)
        self.assertIn(conversation_id, persistence_store.conversations)

    def test_advisor_resolution_priority_contact_group_user(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: Mensaje\nB: Respuesta",
                "user_id": "user-main",
                "contact_id": "contact-ex",
            },
        )
        self.assertEqual(response.status_code, 200)
        result_ids = [item["advisor_id"] for item in response.json()["results"]]
        self.assertEqual(result_ids, ["laura", "lidia", "robert"])

    def test_advisor_partial_fallback_completes_missing_advisors(self):
        class PartialProvider:
            def __init__(self):
                self.calls = 0

            def generate_answer(self, message: str) -> str:
                self.calls += 1
                return (
                    '{"analysis":"Analisis parcial","results":['
                    '{"advisor_id":"laura","advisor_name":"Laura","suggestions":["Solo una"]}'
                    "]}"
                )

        partial_provider = PartialProvider()
        advisor_service._provider = partial_provider
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: test\nB: test",
                "user_id": "user-main",
                "contact_id": "contact-ex",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        result_ids = [item["advisor_id"] for item in body["results"]]
        self.assertEqual(result_ids, ["laura", "lidia", "robert"])
        self.assertEqual(partial_provider.calls, 1)

    def test_advisor_global_fallback_on_invalid_json(self):
        class InvalidProvider:
            def __init__(self):
                self.calls = 0

            def generate_answer(self, message: str) -> str:
                self.calls += 1
                return "respuesta no json"

        invalid_provider = InvalidProvider()
        advisor_service._provider = invalid_provider
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: test\nB: test",
                "user_id": "user-main",
                "contact_id": "contact-ex",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["results"]), 3)
        self.assertEqual(invalid_provider.calls, 1)

    def test_advisor_contact_resolution_exact_name(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "Yo: hola\nEx Pareja: te leo",
                "user_id": "user-main",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["contact_resolution"]["resolved_contact_id"], "contact-ex")
        self.assertEqual(body["contact_resolution"]["resolution_mode"], "exact_match")
        conversation_id = body["conversation_id"]
        self.assertEqual(
            persistence_store.conversations[conversation_id].contact_id,
            "contact-ex",
        )

    def test_advisor_contact_resolution_unresolved_ambiguous(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "Ex Pareja: hola\nColega: te leo",
                "user_id": "user-main",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIsNone(body["contact_resolution"]["resolved_contact_id"])
        self.assertEqual(body["contact_resolution"]["resolution_mode"], "unresolved")

    def test_advisor_explicit_contact_id_has_priority(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "Yo: hola\nEx Pareja: te leo",
                "user_id": "user-main",
                "contact_id": "contact-colleague",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            body["contact_resolution"]["resolved_contact_id"],
            "contact-colleague",
        )
        self.assertEqual(body["contact_resolution"]["resolution_mode"], "exact_match")
        result_ids = [item["advisor_id"] for item in body["results"]]
        self.assertEqual(result_ids[0], "robert")

    def test_advisor_prompt_includes_contact_history_when_contact_resolved(self):
        seed_response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_id": "hist-1",
                "conversation_text": "Yo: hola\nEx Pareja: necesito hablar",
                "user_id": "user-main",
                "contact_id": "contact-ex",
            },
        )
        self.assertEqual(seed_response.status_code, 200)

        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_id": "hist-2",
                "conversation_text": "Yo: sigo pensando esto\nEx Pareja: que hacemos?",
                "user_id": "user-main",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("[INICIO_HISTORIAL_CONTACTO]", self.fake_committee_provider.last_prompt)
        self.assertIn("Perfil conocido del contacto:", self.fake_committee_provider.last_prompt)

    def test_advisor_prompt_skips_contact_history_when_no_contact(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: hola\nB: te leo",
                "user_id": "user-main",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(
            "[INICIO_HISTORIAL_CONTACTO]",
            self.fake_committee_provider.last_prompt,
        )

    def test_advisor_persists_one_output_per_advisor(self):
        response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: test\nB: test",
                "user_id": "user-main",
                "contact_id": "contact-ex",
            },
        )
        self.assertEqual(response.status_code, 200)
        conversation_id = response.json()["conversation_id"]
        self.assertEqual(len(persistence_store.advisor_outputs), 3)
        stored_ids = [item.advisor_id for item in persistence_store.advisor_outputs]
        self.assertEqual(stored_ids, ["laura", "lidia", "robert"])
        self.assertTrue(
            all(item.conversation_id == conversation_id for item in persistence_store.advisor_outputs)
        )

    def test_advisor_history_endpoint(self):
        create_response = self.client.post(
            "/v1/advisor",
            json={
                "conversation_text": "A: test\nB: test",
                "user_id": "user-main",
                "contact_id": "contact-ex",
            },
        )
        conversation_id = create_response.json()["conversation_id"]
        history_response = self.client.get(f"/v1/advisor/conversations/{conversation_id}")
        self.assertEqual(history_response.status_code, 200)
        history = history_response.json()
        self.assertEqual(history["conversation_id"], conversation_id)
        self.assertGreaterEqual(len(history["messages"]), 2)
        self.assertGreaterEqual(len(history["results"]), 1)

    def test_advisor_conversation_list_endpoint(self):
        first = self.client.post(
            "/v1/advisor",
            json={
                "conversation_id": "advisor-session-a",
                "conversation_text": "A: test\nB: test",
                "user_id": "user-main",
                "contact_id": "contact-ex",
            },
        )
        second = self.client.post(
            "/v1/advisor",
            json={
                "conversation_id": "advisor-session-b",
                "conversation_text": "A: test2\nB: test2",
                "user_id": "user-main",
                "contact_id": "contact-colleague",
            },
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)

        response = self.client.get("/v1/advisor/conversations")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("conversations", body)
        self.assertEqual(len(body["conversations"]), 2)
        self.assertEqual(body["conversations"][0]["conversation_id"], "advisor-session-b")
        self.assertEqual(body["conversations"][1]["conversation_id"], "advisor-session-a")
        self.assertIn("analysis_preview", body["conversations"][0])
        self.assertEqual(body["conversations"][0]["advisors_count"], 3)

    def test_advisor_conversation_list_filter_by_contact(self):
        self.client.post(
            "/v1/advisor",
            json={
                "conversation_id": "advisor-session-a",
                "conversation_text": "A: test\nB: test",
                "user_id": "user-main",
                "contact_id": "contact-ex",
            },
        )
        self.client.post(
            "/v1/advisor",
            json={
                "conversation_id": "advisor-session-b",
                "conversation_text": "A: test2\nB: test2",
                "user_id": "user-main",
                "contact_id": "contact-colleague",
            },
        )

        response = self.client.get(
            "/v1/advisor/conversations",
            params={"contact_id": "contact-ex"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["conversations"]), 1)
        self.assertEqual(body["conversations"][0]["conversation_id"], "advisor-session-a")


if __name__ == "__main__":
    unittest.main()
