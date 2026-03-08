import unittest
from uuid import UUID

from fastapi.testclient import TestClient

from main import app
from main import conversations


class TestAPI(unittest.TestCase):
    def setUp(self):
        conversations.clear()
        self.client = TestClient(app)

    def test_health_ok(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_chat_echo_with_defaults(self):
        response = self.client.post("/v1/chat", json={"message": "hola"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["answer"], "echo: hola")
        self.assertIsInstance(body["conversation_id"], str)
        self.assertEqual(str(UUID(body["conversation_id"], version=4)), body["conversation_id"])

    def test_chat_echo_with_conversation_id(self):
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
                "answer": "echo: hello",
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
                        "message": "echo: hola",
                        "channel": "assistant",
                    },
                ],
            },
        )

    def test_get_conversation_history_not_found(self):
        response = self.client.get("/v1/conversations/does-not-exist")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Conversation not found")


if __name__ == "__main__":
    unittest.main()
