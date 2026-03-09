from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class ContactRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def get_by_id(self, user_id: UUID, contact_id: UUID) -> Mapping[str, Any] | None:
        query = """
            SELECT id, user_id, name, relationship_label, notes, created_at, updated_at
            FROM contacts
            WHERE id = %s AND user_id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(contact_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def list_by_user(
        self,
        user_id: UUID,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Mapping[str, Any]]:
        query = """
            SELECT id, user_id, name, relationship_label, notes, created_at, updated_at
            FROM contacts
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id), limit, offset))
            rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def create(
        self,
        *,
        user_id: UUID,
        name: str,
        relationship_label: str | None,
        notes: str | None,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO contacts (user_id, name, relationship_label, notes)
            VALUES (%s, %s, %s, %s)
            RETURNING id, user_id, name, relationship_label, notes, created_at, updated_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id), name, relationship_label, notes))
            row = cursor.fetchone()
        return dict(row)

    def update(
        self,
        *,
        user_id: UUID,
        contact_id: UUID,
        name: str | None = None,
        relationship_label: str | None = None,
        notes: str | None = None,
    ) -> Mapping[str, Any] | None:
        query = """
            UPDATE contacts
            SET
                name = COALESCE(%s, name),
                relationship_label = COALESCE(%s, relationship_label),
                notes = COALESCE(%s, notes),
                updated_at = now()
            WHERE id = %s AND user_id = %s
            RETURNING id, user_id, name, relationship_label, notes, created_at, updated_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (name, relationship_label, notes, str(contact_id), str(user_id)),
            )
            row = cursor.fetchone()
        return dict(row) if row else None

    def delete(self, *, user_id: UUID, contact_id: UUID) -> bool:
        query = "DELETE FROM contacts WHERE id = %s AND user_id = %s"
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(contact_id), str(user_id)))
            rowcount = cursor.rowcount
        return rowcount > 0

