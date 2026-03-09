from collections.abc import Iterable
from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class ConversationMemoryRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def upsert_item(
        self,
        *,
        user_id: UUID,
        contact_id: UUID | None,
        session_id: UUID | None,
        memory_key: str,
        memory_value: Mapping[str, Any],
        source: str = "derived",
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO conversation_memory (
                user_id, contact_id, session_id, memory_key, memory_value, source
            )
            VALUES (%s, %s, %s, %s, %s::jsonb, %s)
            ON CONFLICT (user_id, contact_id, memory_key)
            DO UPDATE SET
                memory_value = EXCLUDED.memory_value,
                source = EXCLUDED.source,
                updated_at = now()
            RETURNING
                id, user_id, contact_id, session_id, memory_key, memory_value,
                source, created_at, updated_at, expires_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(user_id),
                    str(contact_id) if contact_id else None,
                    str(session_id) if session_id else None,
                    memory_key,
                    _to_json_text(memory_value),
                    source,
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def upsert_items(
        self,
        *,
        user_id: UUID,
        contact_id: UUID | None,
        session_id: UUID | None,
        items: Iterable[Mapping[str, Any]],
    ) -> list[Mapping[str, Any]]:
        created: list[Mapping[str, Any]] = []
        for item in items:
            created.append(
                self.upsert_item(
                    user_id=user_id,
                    contact_id=contact_id,
                    session_id=session_id,
                    memory_key=str(item["memory_key"]),
                    memory_value=item.get("memory_value", {}),
                    source=str(item.get("source", "derived")),
                )
            )
        return created

    def list_by_contact(
        self,
        *,
        user_id: UUID,
        contact_id: UUID | None,
    ) -> list[Mapping[str, Any]]:
        query = """
            SELECT
                id, user_id, contact_id, session_id, memory_key, memory_value,
                source, created_at, updated_at, expires_at
            FROM conversation_memory
            WHERE user_id = %s
              AND (%s::uuid IS NULL OR contact_id = %s::uuid)
            ORDER BY updated_at DESC
        """
        contact_id_text = str(contact_id) if contact_id else None
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id), contact_id_text, contact_id_text))
            rows = cursor.fetchall()
        return [dict(row) for row in rows]


def _to_json_text(value: Mapping[str, Any]) -> str:
    import json

    return json.dumps(value, ensure_ascii=True)
