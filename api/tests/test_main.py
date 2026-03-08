import unittest

from fastapi.testclient import TestClient

from main import app


class TestAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_ok(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_chat_echo_with_defaults(self):
        response = self.client.post("/v1/chat", json={"message": "hola"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "conversation_id": "new-conversation",
                "answer": "echo: hola",
            },
        )

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


if __name__ == "__main__":
    unittest.main()
