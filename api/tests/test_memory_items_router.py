import unittest
from datetime import UTC
from datetime import datetime
from uuid import NAMESPACE_URL
from uuid import uuid4
from uuid import uuid5

from fastapi.testclient import TestClient

from app.api.deps import get_ai_provider
from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.services.auth_service import AuthenticatedUser
from main import app


class FakeMemoryItemsRepository:
    def __init__(self, user_id):
        self.user_id = user_id
        self.deleted_count = 0
        self.rows = [
            {
                "id": uuid4(),
                "user_id": user_id,
                "conversation_id": uuid4(),
                "memory_type": "coparenting_exchange_summary",
                "safe_title": "Coordinacion de horarios",
                "safe_summary": "Intercambio funcional resumido de forma segura sobre coordinacion de horarios.",
                "tone": "logistico",
                "risk_level": "moderate",
                "recommended_next_step": "Mantener una respuesta breve y centrada en coordinacion.",
                "source_kind": "ex_chat_capture",
                "is_sensitive": False,
                "source_reference_id": uuid4(),
                "memory_metadata": {"topic_label": "Coordinacion"},
                "created_at": datetime(2026, 3, 28, 10, 0, tzinfo=UTC),
                "updated_at": datetime(2026, 3, 28, 10, 0, tzinfo=UTC),
            },
            {
                "id": uuid4(),
                "user_id": user_id,
                "conversation_id": None,
                "memory_type": "mood_checkin",
                "safe_title": "Check-in emocional",
                "safe_summary": "Registro emocional del dia con animo estable, confianza firme y contacto reciente no.",
                "tone": "estable",
                "risk_level": "low",
                "recommended_next_step": "Mantener seguimiento emocional y revisar cambios si vuelve a haber contacto reciente.",
                "source_kind": "checkin",
                "is_sensitive": False,
                "source_reference_id": uuid4(),
                "memory_metadata": {"mood_level": 2},
                "created_at": datetime(2026, 3, 28, 8, 0, tzinfo=UTC),
                "updated_at": datetime(2026, 3, 28, 8, 0, tzinfo=UTC),
            },
        ]

    def list_by_user(self, *, user_id, memory_type=None, source_kind=None, limit=50, offset=0):
        rows = [row for row in self.rows if row["user_id"] == user_id]
        if memory_type:
            rows = [row for row in rows if row["memory_type"] == memory_type]
        if source_kind:
            rows = [row for row in rows if row["source_kind"] == source_kind]
        return rows[offset : offset + limit]

    def delete_all_for_user(self, *, user_id):
        self.deleted_count = len([row for row in self.rows if row["user_id"] == user_id])
        self.rows = [row for row in self.rows if row["user_id"] != user_id]
        return self.deleted_count


class FakeEmotionalCheckinsRepository:
    def __init__(self) -> None:
        self.deleted_count = 0

    def delete_all_for_user(self, *, user_id):
        del user_id
        self.deleted_count = 3
        return self.deleted_count


class FakeUow:
    def __init__(self, user_id):
        self.memory_items = FakeMemoryItemsRepository(user_id)
        self.emotional_checkins = FakeEmotionalCheckinsRepository()


class DummyProvider:
    def generate_answer(self, message: str) -> str:
        return "{}"


class TestMemoryItemsRouter(unittest.TestCase):
    def setUp(self) -> None:
        app.dependency_overrides.clear()
        self.current_user_id = uuid5(NAMESPACE_URL, "memory-user")
        self.fake_uow = FakeUow(self.current_user_id)
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id=self.current_user_id,
            email="memory@example.com",
            name="Memory User",
            memory_opt_in=False,
            locale="es-UY",
            picture_url=None,
            country_code="UY",
            language_code="es",
            onboarding_completed=True,
        )
        app.dependency_overrides[get_uow] = lambda: self.fake_uow
        app.dependency_overrides[get_ai_provider] = lambda: DummyProvider()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_list_memory_items(self):
        response = self.client.get("/v1/memory-items")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["items"]), 2)
        self.assertEqual(body["items"][0]["memory_type"], "coparenting_exchange_summary")

    def test_ex_partner_report(self):
        response = self.client.get("/v1/memory-items/report/ex-partner")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total_items"], 1)
        self.assertEqual(body["predominant_tone"], "logistico")
        self.assertEqual(body["frequent_topics"][0]["label"], "Coordinacion")

    def test_delete_history(self):
        response = self.client.delete("/v1/memory-items/history")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "emotional_checkins_deleted": 3,
                "memory_items_deleted": 2,
            },
        )


if __name__ == "__main__":
    unittest.main()
