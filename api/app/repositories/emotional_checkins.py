from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class EmotionalCheckinRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def get_latest_for_user_today(self, *, user_id: UUID) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id,
                user_id,
                created_at,
                mood_level,
                confidence_level,
                recent_contact
            FROM emotional_checkins
            WHERE user_id = %s
              AND created_at >= date_trunc('day', now())
              AND created_at < date_trunc('day', now()) + interval '1 day'
            ORDER BY created_at DESC
            LIMIT 1
        """
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
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO emotional_checkins (
                user_id,
                mood_level,
                confidence_level,
                recent_contact,
                created_at
            )
            VALUES (%s, %s, %s, %s, now())
            RETURNING
                id,
                user_id,
                created_at,
                mood_level,
                confidence_level,
                recent_contact
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(user_id),
                    mood_level,
                    confidence_level,
                    recent_contact,
                ),
            )
            row = cursor.fetchone()
        return dict(row)
