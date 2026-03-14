from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class AnalysisResultRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def create(
        self,
        *,
        analysis_id: UUID,
        user_id: UUID,
        case_id: UUID | None,
        contact_id: UUID | None,
        source_type: str,
        input_text: str,
        analysis_json: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO analysis_results (
                id, user_id, case_id, contact_id, source_type, input_text, analysis_json
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING
                id, user_id, case_id, contact_id, source_type, input_text, analysis_json, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(analysis_id),
                    str(user_id),
                    str(case_id) if case_id else None,
                    str(contact_id) if contact_id else None,
                    source_type,
                    input_text,
                    _to_json_text(analysis_json),
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def get_by_id_for_user(
        self,
        *,
        analysis_id: UUID,
        user_id: UUID,
    ) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id, user_id, case_id, contact_id, source_type, input_text, analysis_json, created_at
            FROM analysis_results
            WHERE id = %s AND user_id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(analysis_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def list_recent_by_user(
        self,
        *,
        user_id: UUID,
        limit: int = 20,
    ) -> list[Mapping[str, Any]]:
        query = """
            SELECT
                id, user_id, case_id, contact_id, source_type, input_text, analysis_json, created_at
            FROM analysis_results
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id), limit))
            rows = cursor.fetchall()
        return [dict(row) for row in rows]


def _to_json_text(value: Mapping[str, Any]) -> str:
    import json

    return json.dumps(value, ensure_ascii=True)
