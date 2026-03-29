from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class EmotionalCheckinRepository:
    _OPTIONAL_COLUMNS = ("vinculo_expareja", "interaccion_hijos")

    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def _list_available_columns(self) -> set[str]:
        query = """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'emotional_checkins'
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query)
            rows = cursor.fetchall()

        available_columns: set[str] = set()
        for row in rows:
            if isinstance(row, Mapping):
                column_name = row.get("column_name")
            elif isinstance(row, (tuple, list)) and row:
                column_name = row[0]
            else:
                column_name = None
            if isinstance(column_name, str) and column_name.strip():
                available_columns.add(column_name.strip())
        return available_columns

    def _build_optional_projection(self, available_columns: set[str]) -> str:
        projections: list[str] = []
        for column_name in self._OPTIONAL_COLUMNS:
            if column_name in available_columns:
                projections.append(column_name)
            else:
                projections.append(f"NULL::integer AS {column_name}")
        return ",\n                ".join(projections)

    def get_latest_for_user_today(self, *, user_id: UUID) -> Mapping[str, Any] | None:
        available_columns = self._list_available_columns()
        optional_projection = self._build_optional_projection(available_columns)
        query = """
            SELECT
                id,
                user_id,
                created_at,
                mood_level,
                confidence_level,
                recent_contact,
                {optional_projection}
            FROM emotional_checkins
            WHERE user_id = %s
              AND created_at >= date_trunc('day', now())
              AND created_at < date_trunc('day', now()) + interval '1 day'
            ORDER BY created_at DESC
            LIMIT 1
        """.format(optional_projection=optional_projection)
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id),))
            row = cursor.fetchone()
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
    ) -> Mapping[str, Any]:
        available_columns = self._list_available_columns()
        insert_columns = [
            "user_id",
            "mood_level",
            "confidence_level",
            "recent_contact",
        ]
        insert_values: list[object] = [
            str(user_id),
            mood_level,
            confidence_level,
            recent_contact,
        ]

        if "vinculo_expareja" in available_columns:
            insert_columns.append("vinculo_expareja")
            insert_values.append(vinculo_expareja)
        if "interaccion_hijos" in available_columns:
            insert_columns.append("interaccion_hijos")
            insert_values.append(interaccion_hijos)

        placeholders = ", ".join(["%s"] * len(insert_values))
        optional_projection = self._build_optional_projection(available_columns)
        query = """
            INSERT INTO emotional_checkins (
                {insert_columns},
                created_at
            )
            VALUES ({placeholders}, now())
            RETURNING
                id,
                user_id,
                created_at,
                mood_level,
                confidence_level,
                recent_contact,
                {optional_projection}
        """.format(
            insert_columns=",\n                ".join(insert_columns),
            placeholders=placeholders,
            optional_projection=optional_projection,
        )
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                tuple(insert_values),
            )
            row = cursor.fetchone()
        return dict(row)

    def delete_all_for_user(self, *, user_id: UUID) -> int:
        query = """
            DELETE FROM emotional_checkins
            WHERE user_id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id),))
            return int(cursor.rowcount or 0)
