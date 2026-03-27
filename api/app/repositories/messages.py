from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class MessageRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def get_by_conversation_and_type(
        self,
        *,
        conversation_id: UUID,
        message_type: str,
    ) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id,
                conversation_id,
                role,
                content,
                message_type,
                created_at
            FROM messages
            WHERE conversation_id = %s AND message_type = %s
            ORDER BY created_at DESC
            LIMIT 1
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(conversation_id), message_type))
            row = cursor.fetchone()
        return dict(row) if row else None

    def list_by_conversation(
        self,
        *,
        conversation_id: UUID,
    ) -> list[Mapping[str, Any]]:
        query = """
            SELECT
                id,
                conversation_id,
                role,
                content,
                message_type,
                created_at
            FROM messages
            WHERE conversation_id = %s
            ORDER BY created_at ASC
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(conversation_id),))
            rows = cursor.fetchall() or []
        return [dict(row) for row in rows]

    def create(
        self,
        *,
        conversation_id: UUID,
        role: str,
        content: str,
        message_type: str,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO messages (
                conversation_id,
                role,
                content,
                message_type,
                created_at
            )
            VALUES (%s, %s, %s, %s, now())
            RETURNING
                id,
                conversation_id,
                role,
                content,
                message_type,
                created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(conversation_id),
                    role,
                    content,
                    message_type,
                ),
            )
            row = cursor.fetchone()
        return dict(row)
