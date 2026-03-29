import unittest
from uuid import UUID

from app.repositories.emotional_checkins import EmotionalCheckinRepository


class _FakeCursor:
    def __init__(self, scripted_results: list[object]) -> None:
        self._scripted_results = scripted_results
        self.executed: list[tuple[str, tuple[object, ...] | None]] = []

    def __enter__(self) -> "_FakeCursor":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def execute(self, query: str, params: tuple[object, ...] | None = None) -> None:
        self.executed.append((query, params))

    def fetchall(self):
        result = self._scripted_results.pop(0)
        return result

    def fetchone(self):
        result = self._scripted_results.pop(0)
        return result


class _FakeConnection:
    def __init__(self, scripted_results: list[object]) -> None:
        self.cursor_instance = _FakeCursor(scripted_results)

    def cursor(self) -> _FakeCursor:
        return self.cursor_instance


class TestEmotionalCheckinRepositoryCompatibility(unittest.TestCase):
    def test_get_latest_for_user_today_falls_back_when_optional_columns_are_missing(self) -> None:
        connection = _FakeConnection(
            [
                [
                    {"column_name": "id"},
                    {"column_name": "user_id"},
                    {"column_name": "created_at"},
                    {"column_name": "mood_level"},
                    {"column_name": "confidence_level"},
                    {"column_name": "recent_contact"},
                ],
                {
                    "id": "row-1",
                    "user_id": "user-1",
                    "created_at": "2026-03-29T10:00:00Z",
                    "mood_level": 3,
                    "confidence_level": 4,
                    "recent_contact": False,
                    "vinculo_expareja": None,
                    "interaccion_hijos": None,
                },
            ],
        )
        repository = EmotionalCheckinRepository(connection)

        row = repository.get_latest_for_user_today(
            user_id=UUID("00000000-0000-0000-0000-000000000101"),
        )

        self.assertIsNotNone(row)
        self.assertEqual(row["mood_level"], 3)
        select_query = connection.cursor_instance.executed[1][0]
        self.assertIn("NULL::integer AS vinculo_expareja", select_query)
        self.assertIn("NULL::integer AS interaccion_hijos", select_query)

    def test_create_omits_optional_columns_when_schema_is_legacy(self) -> None:
        connection = _FakeConnection(
            [
                [
                    {"column_name": "id"},
                    {"column_name": "user_id"},
                    {"column_name": "created_at"},
                    {"column_name": "mood_level"},
                    {"column_name": "confidence_level"},
                    {"column_name": "recent_contact"},
                ],
                {
                    "id": "row-2",
                    "user_id": "user-2",
                    "created_at": "2026-03-29T11:00:00Z",
                    "mood_level": 2,
                    "confidence_level": 5,
                    "recent_contact": True,
                    "vinculo_expareja": None,
                    "interaccion_hijos": None,
                },
            ],
        )
        repository = EmotionalCheckinRepository(connection)

        row = repository.create(
            user_id=UUID("00000000-0000-0000-0000-000000000102"),
            mood_level=2,
            confidence_level=5,
            recent_contact=True,
            vinculo_expareja=4,
            interaccion_hijos=3,
        )

        self.assertIsNotNone(row)
        insert_query, insert_params = connection.cursor_instance.executed[1]
        self.assertNotIn("vinculo_expareja", insert_query.split("VALUES", 1)[0])
        self.assertNotIn("interaccion_hijos", insert_query.split("VALUES", 1)[0])
        self.assertEqual(len(insert_params or ()), 4)


if __name__ == "__main__":
    unittest.main()
