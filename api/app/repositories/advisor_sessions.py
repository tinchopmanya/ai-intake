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
        case_id: UUID | None,
        contact_id: UUID | None,
        mode: str,
        quick_mode: bool,
        save_session: bool,
        source_type: str,
        original_input_text: str,
        analysis_id: UUID | None,
        current_step: str = "ingreso",
        status: str = "started",
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO advisor_sessions (
                user_id, case_id, contact_id, mode, quick_mode, status, current_step, save_session,
                source_type, original_input_text, analysis_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING
                id, user_id, case_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, source_type, original_input_text,
                analysis_id, selected_advisor_id, advisor_response_json, started_at, completed_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(user_id),
                    str(case_id) if case_id else None,
                    str(contact_id) if contact_id else None,
                    mode,
                    quick_mode,
                    status,
                    current_step,
                    save_session,
                    source_type,
                    original_input_text,
                    str(analysis_id) if analysis_id else None,
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
                id, user_id, case_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, source_type, original_input_text,
                analysis_id, selected_advisor_id, advisor_response_json, started_at, completed_at, created_at
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
                id, user_id, case_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, source_type, original_input_text,
                analysis_id, selected_advisor_id, advisor_response_json, started_at, completed_at, created_at
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
                id, user_id, case_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, source_type, original_input_text,
                analysis_id, selected_advisor_id, advisor_response_json, started_at, completed_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(session_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def get_by_id(self, *, session_id: UUID, user_id: UUID) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id, user_id, case_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, source_type, original_input_text,
                analysis_id, selected_advisor_id, advisor_response_json, started_at, completed_at, created_at
            FROM advisor_sessions
            WHERE id = %s AND user_id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(session_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def save_advisor_result(
        self,
        *,
        session_id: UUID,
        user_id: UUID,
        advisor_response_json: dict[str, Any],
        analysis_id: UUID | None,
    ) -> Mapping[str, Any] | None:
        query = """
            UPDATE advisor_sessions
            SET
                advisor_response_json = %s::jsonb,
                analysis_id = COALESCE(%s, analysis_id)
            WHERE id = %s AND user_id = %s
            RETURNING
                id, user_id, case_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, source_type, original_input_text,
                analysis_id, selected_advisor_id, advisor_response_json, started_at, completed_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    _to_json_text(advisor_response_json),
                    str(analysis_id) if analysis_id else None,
                    str(session_id),
                    str(user_id),
                ),
            )
            row = cursor.fetchone()
        return dict(row) if row else None

    def set_selected_advisor(
        self,
        *,
        session_id: UUID,
        user_id: UUID,
        selected_advisor_id: str,
    ) -> Mapping[str, Any] | None:
        query = """
            UPDATE advisor_sessions
            SET selected_advisor_id = %s
            WHERE id = %s AND user_id = %s
            RETURNING
                id, user_id, case_id, contact_id, mode, quick_mode, status,
                current_step, save_session, zero_retention_applied, source_type, original_input_text,
                analysis_id, selected_advisor_id, advisor_response_json, started_at, completed_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    selected_advisor_id,
                    str(session_id),
                    str(user_id),
                ),
            )
            row = cursor.fetchone()
        return dict(row) if row else None


def _to_json_text(value: dict[str, Any]) -> str:
    import json

    return json.dumps(value, ensure_ascii=True)

