import unittest
from dataclasses import replace
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from uuid import UUID
from uuid import uuid4
from uuid import uuid5
from uuid import NAMESPACE_URL

from fastapi.testclient import TestClient

from app.api.deps import get_ai_provider
from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.services.auth_service import AuthenticatedUser
from app.services.analysis_registry import analysis_registry
from main import app


class StaticProvider:
    def __init__(self, answer: str) -> None:
        self._answer = answer
        self.calls = 0

    def generate_answer(self, message: str) -> str:
        self.calls += 1
        return self._answer


class FakeSessionsRepo:
    def __init__(self) -> None:
        self.created = 0
        self.completed = 0
        self.errors = 0
        self.updated_steps = 0

    def create_started(self, **kwargs):
        self.created += 1
        return {"id": str(uuid4())}

    def update_step(self, **kwargs):
        self.updated_steps += 1
        return {"ok": True}

    def mark_completed(self, **kwargs):
        self.completed += 1
        return {"ok": True}

    def mark_error(self, **kwargs):
        self.errors += 1
        return {"ok": True}


class FakeOutputsRepo:
    def __init__(self) -> None:
        self.create_calls = 0

    def create_one(self, **kwargs):
        self.create_calls += 1
        return {"id": str(uuid4())}


class FakeMemoryRepo:
    def __init__(self) -> None:
        self.upsert_calls = 0

    def upsert_items(self, **kwargs):
        self.upsert_calls += 1
        return []


class FakeTrackingRepo:
    def __init__(self) -> None:
        self.events: list[str] = []

    def append(self, **kwargs):
        self.events.append(str(kwargs.get("event_name")))
        return True


class FakeContactsRepo:
    def get_by_id(self, **kwargs):
        return None


class FakeUow:
    def __init__(self) -> None:
        self.sessions = FakeSessionsRepo()
        self.outputs = FakeOutputsRepo()
        self.memory = FakeMemoryRepo()
        self.tracking = FakeTrackingRepo()
        self.contacts = FakeContactsRepo()


class TestAppMvpAdvisorFlow(unittest.TestCase):
    def setUp(self) -> None:
        app.dependency_overrides.clear()
        self._active_user_label = "user-a"
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            id=uuid5(NAMESPACE_URL, self._active_user_label),
            email="flow@example.com",
            name="Flow User",
            memory_opt_in=False,
            locale="es-LA",
            picture_url=None,
            country_code="UY",
            language_code="es",
            onboarding_completed=False,
        )
        self.client = TestClient(app)
        with analysis_registry._lock:  # noqa: SLF001 - test-only cleanup
            analysis_registry._items.clear()  # noqa: SLF001 - test-only cleanup

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        with analysis_registry._lock:  # noqa: SLF001 - test-only cleanup
            analysis_registry._items.clear()  # noqa: SLF001 - test-only cleanup

    def _post_analysis(self, *, user_id: str = "user-a", quick_mode: bool = False):
        self._active_user_label = user_id
        return self.client.post(
            "/v1/analysis",
            json={
                "message_text": "Necesito coordinar retiro del nene hoy!!!",
                "mode": "reactive",
                "relationship_type": "familia",
                "quick_mode": quick_mode,
                "context": {"user_id": user_id},
            },
        )

    def _post_advisor(
        self,
        *,
        user_id: str,
        analysis_id: str | None = None,
        quick_mode: bool = False,
        save_session: bool = False,
        memory_opt_in: bool = False,
    ):
        self._active_user_label = user_id
        payload = {
            "message_text": "Necesito responder este mensaje con calma",
            "mode": "reactive",
            "relationship_type": "familia",
            "quick_mode": quick_mode,
            "save_session": save_session,
            "context": {"user_id": user_id, "memory_opt_in": memory_opt_in},
        }
        if analysis_id:
            payload["analysis_id"] = analysis_id
        return self.client.post("/v1/advisor", json=payload)

    def test_analysis_returns_valid_structure(self):
        response = self._post_analysis(user_id="user-a")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("analysis_id", body)
        self.assertIsInstance(body["analysis_id"], str)
        UUID(body["analysis_id"])
        self.assertIn("risk_flags", body)
        self.assertIn("emotional_context", body)
        self.assertIn("ui_alerts", body)
        self.assertIn("summary", body)

    def test_advisor_with_valid_analysis_id_same_user(self):
        provider = StaticProvider(
            '{"responses":[{"advisor":"laura","text":"Texto Laura"},'
            '{"advisor":"robert","text":"Texto Robert"},'
            '{"advisor":"lidia","text":"Texto Lidia"}]}'
        )
        app.dependency_overrides[get_ai_provider] = lambda: provider

        analysis_response = self._post_analysis(user_id="user-a")
        analysis_id = analysis_response.json()["analysis_id"]

        response = self._post_advisor(user_id="user-a", analysis_id=analysis_id)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["responses"]), 3)
        self.assertFalse(body["persistence"]["save_session"])
        self.assertGreaterEqual(provider.calls, 1)

    def test_advisor_returns_403_when_analysis_belongs_to_another_user(self):
        provider = StaticProvider('{"responses":[]}')
        app.dependency_overrides[get_ai_provider] = lambda: provider

        analysis_response = self._post_analysis(user_id="user-a")
        analysis_id = analysis_response.json()["analysis_id"]

        response = self._post_advisor(user_id="user-b", analysis_id=analysis_id)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "analysis_id_forbidden")

    def test_advisor_returns_404_when_analysis_missing_or_expired(self):
        provider = StaticProvider('{"responses":[]}')
        app.dependency_overrides[get_ai_provider] = lambda: provider

        # Missing
        response_missing = self._post_advisor(
            user_id="user-a",
            analysis_id=str(uuid4()),
        )
        self.assertEqual(response_missing.status_code, 404)
        self.assertEqual(
            response_missing.json()["detail"],
            "analysis_id_not_found_or_expired",
        )

        # Expired
        analysis_response = self._post_analysis(user_id="user-a")
        analysis_id = UUID(analysis_response.json()["analysis_id"])
        with analysis_registry._lock:  # noqa: SLF001 - test-only mutation
            stored = analysis_registry._items[analysis_id]  # noqa: SLF001
            analysis_registry._items[analysis_id] = replace(  # noqa: SLF001
                stored,
                expires_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        response_expired = self._post_advisor(user_id="user-a", analysis_id=str(analysis_id))
        self.assertEqual(response_expired.status_code, 404)
        self.assertEqual(
            response_expired.json()["detail"],
            "analysis_id_not_found_or_expired",
        )

    def test_advisor_works_without_analysis_id(self):
        provider = StaticProvider(
            '{"responses":[{"advisor":"laura","text":"L"},{"advisor":"robert","text":"R"},{"advisor":"lidia","text":"I"}]}'
        )
        app.dependency_overrides[get_ai_provider] = lambda: provider

        response = self._post_advisor(user_id="user-a")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["responses"]), 3)
        self.assertIsNotNone(body["session_id"])

    def test_advisor_quick_mode(self):
        provider = StaticProvider(
            '{"responses":[{"advisor":"laura","text":"L"},{"advisor":"robert","text":"R"},{"advisor":"lidia","text":"I"}]}'
        )
        app.dependency_overrides[get_ai_provider] = lambda: provider

        response = self._post_advisor(user_id="user-a", quick_mode=True)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["quick_mode"])
        self.assertIsNone(body["analysis"])

    def test_provider_broken_response_triggers_usable_fallback(self):
        provider = StaticProvider("not-json-response")
        app.dependency_overrides[get_ai_provider] = lambda: provider

        response = self._post_advisor(user_id="user-a")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["responses"]), 3)
        self.assertTrue(all(item["text"] for item in body["responses"]))

    def test_save_session_false_does_not_persist_outputs_or_memory(self):
        provider = StaticProvider(
            '{"responses":[{"advisor":"laura","text":"L"},{"advisor":"robert","text":"R"},{"advisor":"lidia","text":"I"}]}'
        )
        fake_uow = FakeUow()
        app.dependency_overrides[get_ai_provider] = lambda: provider
        app.dependency_overrides[get_uow] = lambda: fake_uow

        response = self._post_advisor(
            user_id="user-a",
            save_session=False,
            memory_opt_in=True,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["persistence"]["outputs_persisted"])
        self.assertFalse(body["persistence"]["memory_persisted"])
        self.assertEqual(fake_uow.outputs.create_calls, 0)
        self.assertEqual(fake_uow.memory.upsert_calls, 0)


if __name__ == "__main__":
    unittest.main()

