from collections.abc import Mapping
from datetime import date
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class IncidentRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def create(
        self,
        *,
        user_id: UUID,
        case_id: UUID,
        contact_id: UUID | None,
        incident_type: str,
        title: str,
        description: str,
        source_type: str,
        related_analysis_id: UUID | None,
        related_session_id: UUID | None,
        incident_date: date,
        confirmed: bool,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO incidents (
                user_id, case_id, contact_id, incident_type, title, description, source_type,
                related_analysis_id, related_session_id, incident_date, confirmed
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING
                id, user_id, case_id, contact_id, incident_type, title, description, source_type,
                related_analysis_id, related_session_id, incident_date, confirmed, created_at, updated_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(user_id),
                    str(case_id),
                    str(contact_id) if contact_id else None,
                    incident_type,
                    title,
                    description,
                    source_type,
                    str(related_analysis_id) if related_analysis_id else None,
                    str(related_session_id) if related_session_id else None,
                    incident_date,
                    confirmed,
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def list_by_user(
        self,
        *,
        user_id: UUID,
        case_id: UUID | None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Mapping[str, Any]]:
        query = """
            SELECT
                id, user_id, case_id, contact_id, incident_type, title, description, source_type,
                related_analysis_id, related_session_id, incident_date, confirmed, created_at, updated_at
            FROM incidents
            WHERE user_id = %s
              AND (%s::uuid IS NULL OR case_id = %s::uuid)
            ORDER BY incident_date DESC, created_at DESC
            LIMIT %s OFFSET %s
        """
        case_id_text = str(case_id) if case_id else None
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id), case_id_text, case_id_text, limit, offset))
            rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def get_by_id(
        self,
        *,
        user_id: UUID,
        incident_id: UUID,
    ) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id, user_id, case_id, contact_id, incident_type, title, description, source_type,
                related_analysis_id, related_session_id, incident_date, confirmed, created_at, updated_at
            FROM incidents
            WHERE id = %s AND user_id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(incident_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def update(
        self,
        *,
        user_id: UUID,
        incident_id: UUID,
        incident_type: str | None,
        title: str | None,
        description: str | None,
        incident_date: date | None,
        confirmed: bool | None,
    ) -> Mapping[str, Any] | None:
        query = """
            UPDATE incidents
            SET
                incident_type = COALESCE(%s, incident_type),
                title = COALESCE(%s, title),
                description = COALESCE(%s, description),
                incident_date = COALESCE(%s, incident_date),
                confirmed = COALESCE(%s, confirmed),
                updated_at = now()
            WHERE id = %s AND user_id = %s
            RETURNING
                id, user_id, case_id, contact_id, incident_type, title, description, source_type,
                related_analysis_id, related_session_id, incident_date, confirmed, created_at, updated_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    incident_type,
                    title,
                    description,
                    incident_date,
                    confirmed,
                    str(incident_id),
                    str(user_id),
                ),
            )
            row = cursor.fetchone()
        return dict(row) if row else None
