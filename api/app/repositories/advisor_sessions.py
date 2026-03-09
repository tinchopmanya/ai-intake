from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class AdvisorSessionRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def create_started(
        self,
        *,
        user_id: UUID,
        contact_id: UUID | None,
        mode: str,
        quick_mode: bool,
        save_session: bool,
        current_step: str = "ingreso",
        status: str = "started",
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO advisor_sessions (
                user_id, contact_id, mode, quick_mode, status, current_step, save_session
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING
                id, user_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, started_at, completed_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(user_id),
                    str(contact_id) if contact_id else None,
                    mode,
                    quick_mode,
                    status,
                    current_step,
                    save_session,
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def update_step(
        self,
        *,
        session_id: UUID,
        user_id: UUID,
        current_step: str,
    ) -> Mapping[str, Any] | None:
        query = """
            UPDATE advisor_sessions
            SET current_step = %s
            WHERE id = %s AND user_id = %s
            RETURNING
                id, user_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, started_at, completed_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (current_step, str(session_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def mark_completed(self, *, session_id: UUID, user_id: UUID) -> Mapping[str, Any] | None:
        query = """
            UPDATE advisor_sessions
            SET status = 'completed', completed_at = now(), current_step = 'respuesta'
            WHERE id = %s AND user_id = %s
            RETURNING
                id, user_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, started_at, completed_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(session_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def mark_error(
        self,
        *,
        session_id: UUID,
        user_id: UUID,
    ) -> Mapping[str, Any] | None:
        query = """
            UPDATE advisor_sessions
            SET status = 'error'
            WHERE id = %s AND user_id = %s
            RETURNING
                id, user_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, started_at, completed_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(session_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def get_by_id(self, *, session_id: UUID, user_id: UUID) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id, user_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, started_at, completed_at, created_at
            FROM advisor_sessions
            WHERE id = %s AND user_id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(session_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

