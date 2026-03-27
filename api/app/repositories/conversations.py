from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class ConversationRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def list_by_user(
        self,
        *,
        user_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Mapping[str, Any]]:
        query = """
            SELECT
                id,
                user_id,
                title,
                title_status,
                advisor_id,
                created_at,
                last_message_at
            FROM conversations
            WHERE user_id = %s
            ORDER BY last_message_at DESC, created_at DESC
            LIMIT %s OFFSET %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id), limit, offset))
            rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def get_by_id(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
    ) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id,
                user_id,
                title,
                title_status,
                advisor_id,
                created_at,
                last_message_at
            FROM conversations
            WHERE id = %s AND user_id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(conversation_id), str(user_id)))
            row = cursor.fetchone()
        return dict(row) if row else None

    def create(
        self,
        *,
        user_id: UUID,
        title: str,
        title_status: str,
        advisor_id: str | None = None,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO conversations (
                user_id,
                title,
                title_status,
                advisor_id,
                created_at,
                last_message_at
            )
            VALUES (%s, %s, %s, %s, now(), now())
            RETURNING
                id,
                user_id,
                title,
                title_status,
                advisor_id,
                created_at,
                last_message_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(user_id),
                    title,
                    title_status,
                    advisor_id,
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def update_title(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID,
        title: str,
        title_status: str,
    ) -> Mapping[str, Any] | None:
        query = """
            UPDATE conversations
            SET
                title = %s,
                title_status = %s
            WHERE id = %s AND user_id = %s
            RETURNING
                id,
                user_id,
                title,
                title_status,
                advisor_id,
                created_at,
                last_message_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    title,
                    title_status,
                    str(conversation_id),
                    str(user_id),
                ),
            )
            row = cursor.fetchone()
        return dict(row) if row else None
