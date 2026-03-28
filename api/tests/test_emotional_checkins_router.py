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


class FakeEmotionalCheckinRepository:
    def __init__(self) -> None:
        self.created_payloads: list[dict[str, object]] = []
        self.today_rows_by_user: dict[UUID, dict[str, object]] = {}

    def get_latest_for_user_today(self, *, user_id: UUID):
        row = self.today_rows_by_user.get(user_id)
        return dict(row) if row else None

    def create(
        self,
        *,
        user_id: UUID,
        mood_level: int,
        confidence_level: int,
        recent_contact: bool,
        vinculo_expareja: int | None,
        interaccion_hijos: int | None,
    ):
        created = {
            "id": uuid4(),
            "user_id": user_id,
            "created_at": datetime(2026, 3, 26, 11, 0, tzinfo=UTC),
            "mood_level": mood_level,
            "confidence_level": confidence_level,
            "recent_contact": recent_contact,
            "vinculo_expareja": vinculo_expareja,
            "interaccion_hijos": interaccion_hijos,
        }
        self.created_payloads.append(created)
        self.today_rows_by_user[user_id] = created
        return created


class FakeUow:
    def __init__(self) -> None:
        self.emotional_checkins = FakeEmotionalCheckinRepository()
        self.memory_items = type(
            "FakeMemoryItemsRepo",
            (),
            {
                "__init__": lambda self: setattr(self, "saved", []),
                "upsert_by_source_reference": lambda self, **kwargs: self.saved.append(kwargs) or kwargs,
            },
        )()


class TestEmotionalCheckinsRouter(unittest.TestCase):
    def setUp(self) -> None:
        app.dependency_overrides.clear()
        self._active_user_label = "user-a"
        self.current_user_id = uuid5(NAMESPACE_URL, self._active_user_label)
        self.fake_uow = FakeUow()
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id=self.current_user_id,
            email="checkins@example.com",
            name="Checkin User",
            memory_opt_in=False,
            locale="es-UY",
            picture_url=None,
            country_code="UY",
            language_code="es",
            onboarding_completed=False,
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

    def test_get_today_status_without_checkin(self):
        response = self.client.get("/v1/emotional-checkins/today")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "has_checkin_today": False,
                "today_checkin": None,
            },
        )

    def test_create_checkin(self):
        response = self.client.post(
            "/v1/emotional-checkins",
            json={
                "mood_level": 3,
                "confidence_level": 2,
                "recent_contact": True,
                "vinculo_expareja": 2,
            },
        )
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["mood_level"], 3)
        self.assertEqual(body["confidence_level"], 2)
        self.assertTrue(body["recent_contact"])
        self.assertEqual(body["vinculo_expareja"], 2)
        self.assertIsNone(body["interaccion_hijos"])
        self.assertEqual(self.fake_uow.emotional_checkins.created_payloads[-1]["user_id"], self.current_user_id)
        self.assertEqual(self.fake_uow.emotional_checkins.created_payloads[-1]["vinculo_expareja"], 2)
        self.assertIsNone(self.fake_uow.emotional_checkins.created_payloads[-1]["interaccion_hijos"])
        self.assertEqual(len(self.fake_uow.memory_items.saved), 1)
        self.assertEqual(self.fake_uow.memory_items.saved[0]["memory_type"], "mood_checkin")
        self.assertEqual(self.fake_uow.memory_items.saved[0]["memory_metadata"]["vinculo_expareja"], 2)
        self.assertIsNone(self.fake_uow.memory_items.saved[0]["memory_metadata"]["interaccion_hijos"])

    def test_get_today_status_with_existing_checkin(self):
        existing = {
            "id": uuid4(),
            "user_id": self.current_user_id,
            "created_at": datetime(2026, 3, 26, 12, 30, tzinfo=UTC),
            "mood_level": 4,
            "confidence_level": 1,
            "recent_contact": False,
            "vinculo_expareja": 5,
            "interaccion_hijos": None,
        }
        self.fake_uow.emotional_checkins.today_rows_by_user[self.current_user_id] = existing

        response = self.client.get("/v1/emotional-checkins/today")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["has_checkin_today"])
        self.assertIsNotNone(body["today_checkin"])
        self.assertEqual(body["today_checkin"]["mood_level"], 4)
        self.assertEqual(body["today_checkin"]["confidence_level"], 1)
        self.assertFalse(body["today_checkin"]["recent_contact"])
        self.assertEqual(body["today_checkin"]["vinculo_expareja"], 5)
        self.assertIsNone(body["today_checkin"]["interaccion_hijos"])


if __name__ == "__main__":
    unittest.main()
