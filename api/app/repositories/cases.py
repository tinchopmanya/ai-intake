from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class CaseRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def create(
        self,
        *,
        user_id: UUID,
        title: str,
        contact_name: str | None,
        relationship_label: str | None,
        summary: str | None,
        contact_id: UUID | None,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO cases (
                user_id, contact_id, title, contact_name, relationship_label, summary, last_activity_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, now())
            RETURNING
                id, user_id, contact_id, title, contact_name, relationship_label,
                summary, last_activity_at, created_at, updated_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(user_id),
                    str(contact_id) if contact_id else None,
                    title,
                    contact_name,
                    relationship_label,
                    summary or "",
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def list_by_user(
        self,
        *,
        user_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Mapping[str, Any]]:
        query = """
            SELECT
                id, user_id, contact_id, title, contact_name, relationship_label,
                summary, last_activity_at, created_at, updated_at
            FROM cases
            WHERE user_id = %s
            ORDER BY last_activity_at DESC, created_at DESC
            LIMIT %s OFFSET %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id), limit, offset))
            rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def get_default_for_user(self, *, user_id: UUID) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id, user_id, contact_id, title, contact_name, relationship_label,
                summary, last_activity_at, created_at, updated_at
            FROM cases
            WHERE user_id = %s
            ORDER BY last_activity_at DESC, created_at DESC
            LIMIT 1
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id),))
            row = cursor.fetchone()
        return dict(row) if row else None

    def get_by_id(self, *, user_id: UUID, case_id: UUID) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id, user_id, contact_id, title, contact_name, relationship_label,
                summary, last_activity_at, created_at, updated_at
            FROM cases
            WHERE id = %s AND user_id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(case_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def update(
        self,
        *,
        user_id: UUID,
        case_id: UUID,
        title: str | None,
        contact_name: str | None,
        relationship_label: str | None,
        summary: str | None,
        contact_id: UUID | None,
    ) -> Mapping[str, Any] | None:
        query = """
            UPDATE cases
            SET
                title = COALESCE(%s, title),
                contact_name = COALESCE(%s, contact_name),
                relationship_label = COALESCE(%s, relationship_label),
                summary = COALESCE(%s, summary),
                contact_id = COALESCE(%s, contact_id),
                updated_at = now()
            WHERE id = %s AND user_id = %s
            RETURNING
                id, user_id, contact_id, title, contact_name, relationship_label,
                summary, last_activity_at, created_at, updated_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    title,
                    contact_name,
                    relationship_label,
                    summary,
                    str(contact_id) if contact_id else None,
                    str(case_id),
                    str(user_id),
                ),
            )
            row = cursor.fetchone()
        return dict(row) if row else None

    def touch_activity(self, *, user_id: UUID, case_id: UUID) -> Mapping[str, Any] | None:
        query = """
            UPDATE cases
            SET last_activity_at = now(), updated_at = now()
            WHERE id = %s AND user_id = %s
            RETURNING
                id, user_id, contact_id, title, contact_name, relationship_label,
                summary, last_activity_at, created_at, updated_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(case_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def append_summary_entry(
        self,
        *,
        user_id: UUID,
        case_id: UUID,
        entry: str,
        max_chars: int = 2000,
    ) -> Mapping[str, Any] | None:
        normalized = " ".join(entry.strip().split())
        if not normalized:
            return self.get_by_id(user_id=user_id, case_id=case_id)
        query = """
            UPDATE cases
            SET
                summary = RIGHT(
                    CASE
                        WHEN summary IS NULL OR summary = '' THEN %s
                        ELSE summary || E'\n- ' || %s
                    END,
                    %s
                ),
                last_activity_at = now(),
                updated_at = now()
            WHERE id = %s AND user_id = %s
            RETURNING
                id, user_id, contact_id, title, contact_name, relationship_label,
                summary, last_activity_at, created_at, updated_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    f"- {normalized}",
                    normalized,
                    max_chars,
                    str(case_id),
                    str(user_id),
                ),
            )
            row = cursor.fetchone()
        return dict(row) if row else None
