import unittest
from datetime import UTC
from datetime import datetime
from uuid import NAMESPACE_URL
from uuid import UUID
from uuid import uuid4
from uuid import uuid5

from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.services.auth_service import AuthenticatedUser
from main import app


class FakeConversationRepository:
    def __init__(self, owner_id: UUID, conversation_id: UUID) -> None:
        self.owner_id = owner_id
        self.conversation_id = conversation_id

    def get_by_id(self, *, user_id: UUID, conversation_id: UUID):
        if user_id != self.owner_id or conversation_id != self.conversation_id:
            return None
        return {
            "id": self.conversation_id,
            "user_id": self.owner_id,
            "title": "Nueva conversacion",
            "title_status": "pending",
            "advisor_id": None,
            "created_at": datetime(2026, 3, 26, 10, 0, tzinfo=UTC),
            "last_message_at": datetime(2026, 3, 26, 10, 0, tzinfo=UTC),
        }


class FakeMessageRepository:
    def __init__(self) -> None:
        self.rows_by_key: dict[tuple[UUID, str], dict[str, object]] = {}
        self.created_payloads: list[dict[str, object]] = []

    def get_by_conversation_and_type(self, *, conversation_id: UUID, message_type: str):
        row = self.rows_by_key.get((conversation_id, message_type))
        return dict(row) if row else None

    def create(self, *, conversation_id: UUID, role: str, content: str, message_type: str):
        created = {
            "id": uuid4(),
            "conversation_id": conversation_id,
            "role": role,
            "content": content,
            "message_type": message_type,
            "created_at": datetime(2026, 3, 26, 11, 0, tzinfo=UTC),
        }
        self.rows_by_key[(conversation_id, message_type)] = created
        self.created_payloads.append(created)
        return created

    def list_by_conversation(self, *, conversation_id: UUID):
        rows = [
            dict(row)
            for row in self.rows_by_key.values()
            if row["conversation_id"] == conversation_id
        ]
        rows.sort(key=lambda row: row["created_at"])
        return rows


class FakeUow:
    def __init__(self, owner_id: UUID, conversation_id: UUID) -> None:
        self.conversations = FakeConversationRepository(owner_id, conversation_id)
        self.messages = FakeMessageRepository()


class TestMessagesRouter(unittest.TestCase):
    def setUp(self) -> None:
        app.dependency_overrides.clear()
        self.current_user_id = uuid5(NAMESPACE_URL, "user-a")
        self.conversation_id = uuid4()
        self.fake_uow = FakeUow(self.current_user_id, self.conversation_id)
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id=self.current_user_id,
            email="messages@example.com",
            name="Messages User",
            memory_opt_in=False,
            locale="es-UY",
            picture_url=None,
            country_code="UY",
            language_code="es",
            onboarding_completed=False,
        )
        app.dependency_overrides[get_uow] = lambda: self.fake_uow
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_create_message_persists_source_text(self):
        response = self.client.post(
            "/v1/messages",
            json={
                "conversation_id": str(self.conversation_id),
                "role": "user",
                "content": "Necesito revisar este mensaje antes de responder.",
                "message_type": "source_text",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["message_type"], "source_text")
        self.assertEqual(body["role"], "user")
        self.assertEqual(len(self.fake_uow.messages.created_payloads), 1)

    def test_create_message_returns_existing_row_when_type_already_saved(self):
        existing = self.fake_uow.messages.create(
            conversation_id=self.conversation_id,
            role="system",
            content="Responder breve y neutro",
            message_type="analysis_action",
        )

        response = self.client.post(
            "/v1/messages",
            json={
                "conversation_id": str(self.conversation_id),
                "role": "system",
                "content": "Poner un limite claro",
                "message_type": "analysis_action",
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["id"], str(existing["id"]))
        self.assertEqual(body["content"], "Responder breve y neutro")
        self.assertEqual(len(self.fake_uow.messages.created_payloads), 1)

    def test_create_message_requires_owned_conversation(self):
        response = self.client.post(
            "/v1/messages",
            json={
                "conversation_id": str(uuid4()),
                "role": "assistant",
                "content": "Texto sugerido",
                "message_type": "selected_reply",
            },
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "conversation_not_found")

    def test_list_messages_returns_ordered_rows_for_owned_conversation(self):
        self.fake_uow.messages.rows_by_key[(self.conversation_id, "source_text")] = {
            "id": uuid4(),
            "conversation_id": self.conversation_id,
            "role": "user",
            "content": "Texto original",
            "message_type": "source_text",
            "created_at": datetime(2026, 3, 26, 10, 30, tzinfo=UTC),
        }
        self.fake_uow.messages.rows_by_key[(self.conversation_id, "analysis_action")] = {
            "id": uuid4(),
            "conversation_id": self.conversation_id,
            "role": "system",
            "content": "Responder breve y neutro",
            "message_type": "analysis_action",
            "created_at": datetime(2026, 3, 26, 10, 45, tzinfo=UTC),
        }

        response = self.client.get(f"/v1/conversations/{self.conversation_id}/messages")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["messages"]), 2)
        self.assertEqual(body["messages"][0]["message_type"], "source_text")
        self.assertEqual(body["messages"][1]["message_type"], "analysis_action")

    def test_list_messages_requires_owned_conversation(self):
        response = self.client.get(f"/v1/conversations/{uuid4()}/messages")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "conversation_not_found")


if __name__ == "__main__":
    unittest.main()
