import unittest
from datetime import UTC
from datetime import datetime
from uuid import NAMESPACE_URL
from uuid import UUID
from uuid import uuid4
from uuid import uuid5

from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.api.deps import get_ai_provider
from app.api.deps import get_uow
from app.services.auth_service import AuthenticatedUser
from main import app


class FakeConversationRepository:
    def __init__(self) -> None:
        self.created_payloads: list[dict[str, object]] = []
        self.updated_payloads: list[dict[str, object]] = []
        self.rows = [
            {
                "id": uuid4(),
                "user_id": uuid5(NAMESPACE_URL, "user-a"),
                "title": "Nueva conversacion",
                "title_status": "pending",
                "advisor_id": None,
                "created_at": datetime(2026, 3, 26, 10, 30, tzinfo=UTC),
                "last_message_at": datetime(2026, 3, 26, 10, 30, tzinfo=UTC),
            },
            {
                "id": uuid4(),
                "user_id": uuid5(NAMESPACE_URL, "user-a"),
                "title": "Nueva conversacion",
                "title_status": "fallback",
                "advisor_id": "laura",
                "created_at": datetime(2026, 3, 25, 18, 15, tzinfo=UTC),
                "last_message_at": datetime(2026, 3, 25, 18, 40, tzinfo=UTC),
            },
        ]

    def list_by_user(self, *, user_id: UUID, limit: int = 50, offset: int = 0):
        filtered = [row for row in self.rows if row["user_id"] == user_id]
        sorted_rows = sorted(
            filtered,
            key=lambda row: (row["last_message_at"], row["created_at"]),
            reverse=True,
        )
        return sorted_rows[offset : offset + limit]

    def create(self, *, user_id: UUID, title: str, title_status: str, advisor_id: str | None = None):
        created = {
            "id": uuid4(),
            "user_id": user_id,
            "title": title,
            "title_status": title_status,
            "advisor_id": advisor_id,
            "created_at": datetime(2026, 3, 26, 11, 0, tzinfo=UTC),
            "last_message_at": datetime(2026, 3, 26, 11, 0, tzinfo=UTC),
        }
        self.created_payloads.append(created)
        self.rows.insert(0, created)
        return created

    def update_title(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        title: str,
        title_status: str,
    ):
        self.updated_payloads.append(
            {
                "user_id": user_id,
                "conversation_id": conversation_id,
                "title": title,
                "title_status": title_status,
            },
        )
        for index, row in enumerate(self.rows):
            if row["id"] != conversation_id or row["user_id"] != user_id:
                continue
            updated = {
                **row,
                "title": title,
                "title_status": title_status,
            }
            self.rows[index] = updated
            return updated
        return None


class FakeUow:
    def __init__(self) -> None:
        self.conversations = FakeConversationRepository()
        self.cases = type(
            "FakeCasesRepo",
            (),
            {"get_default_for_user": lambda self, *, user_id: {"contact_name": "Martin"}},
        )()
        self.memory_items = type(
            "FakeMemoryItemsRepo",
            (),
            {
                "__init__": lambda self: setattr(self, "saved", []),
                "upsert_by_source_reference": lambda self, **kwargs: self.saved.append(kwargs) or kwargs,
            },
        )()


class TestConversationsRouter(unittest.TestCase):
    def setUp(self) -> None:
        app.dependency_overrides.clear()
        self._active_user_label = "user-a"
        self.fake_uow = FakeUow()
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id=uuid5(NAMESPACE_URL, self._active_user_label),
            email="conversations@example.com",
            name="Conversation User",
            memory_opt_in=False,
            locale="es-UY",
            picture_url=None,
            country_code="UY",
            language_code="es",
            onboarding_completed=False,
            ex_partner_name="Martin",
            relationship_mode="coparenting",
        )
        app.dependency_overrides[get_uow] = lambda: self.fake_uow
        app.dependency_overrides[get_ai_provider] = lambda: type(
            "FallbackProvider",
            (),
            {"generate_answer": lambda self, message: "Gemini no esta configurado."},
        )()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_list_conversations_returns_current_user_items(self):
        response = self.client.get("/v1/conversations")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("conversations", body)
        self.assertEqual(len(body["conversations"]), 2)
        self.assertEqual(body["conversations"][0]["title"], "Nueva conversacion")
        self.assertEqual(body["conversations"][0]["title_status"], "pending")
        self.assertEqual(body["conversations"][1]["advisor_id"], "laura")

    def test_create_conversation_uses_authenticated_user(self):
        response = self.client.post("/v1/conversations", json={"advisor_id": "robert"})
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["title"], "Nueva conversacion")
        self.assertEqual(body["title_status"], "pending")
        self.assertEqual(body["advisor_id"], "robert")
        self.assertEqual(
            self.fake_uow.conversations.created_payloads[-1]["user_id"],
            uuid5(NAMESPACE_URL, "user-a"),
        )

    def test_patch_conversation_updates_title_with_safe_label(self):
        conversation_id = str(self.fake_uow.conversations.rows[0]["id"])

        response = self.client.patch(
            f"/v1/conversations/{conversation_id}",
            json={
                "source_text": "Necesito coordinar los horarios de retiro y entrega de los chicos.",
                "analysis_summary": "Hay una necesidad concreta de organizacion y coordinacion.",
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["title"], "Coordinacion de horarios")
        self.assertEqual(body["title_status"], "fallback")
        self.assertEqual(
            self.fake_uow.conversations.updated_payloads[-1]["user_id"],
            uuid5(NAMESPACE_URL, "user-a"),
        )
        self.assertEqual(len(self.fake_uow.memory_items.saved), 1)
        persisted_memory = self.fake_uow.memory_items.saved[0]
        self.assertEqual(persisted_memory["memory_type"], "coparenting_exchange_summary")
        self.assertEqual(persisted_memory["source_reference_id"], UUID(conversation_id))
        self.assertNotIn("Martin", persisted_memory["safe_summary"])


if __name__ == "__main__":
    unittest.main()
