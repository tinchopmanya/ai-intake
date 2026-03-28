from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class MemoryItemRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def upsert_by_source_reference(
        self,
        *,
        user_id: UUID,
        conversation_id: UUID | None,
        memory_type: str,
        safe_title: str,
        safe_summary: str,
        tone: str | None,
        risk_level: str | None,
        recommended_next_step: str | None,
        source_kind: str,
        is_sensitive: bool,
        source_reference_id: UUID | None,
        memory_metadata: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO memory_items (
                user_id,
                conversation_id,
                memory_type,
                safe_title,
                safe_summary,
                tone,
                risk_level,
                recommended_next_step,
                source_kind,
                is_sensitive,
                source_reference_id,
                memory_metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (user_id, memory_type, source_reference_id)
            WHERE source_reference_id IS NOT NULL
            DO UPDATE SET
                conversation_id = COALESCE(EXCLUDED.conversation_id, memory_items.conversation_id),
                safe_title = EXCLUDED.safe_title,
                safe_summary = EXCLUDED.safe_summary,
                tone = EXCLUDED.tone,
                risk_level = EXCLUDED.risk_level,
                recommended_next_step = EXCLUDED.recommended_next_step,
                source_kind = EXCLUDED.source_kind,
                is_sensitive = EXCLUDED.is_sensitive,
                memory_metadata = EXCLUDED.memory_metadata,
                updated_at = now()
            RETURNING
                id,
                user_id,
                conversation_id,
                memory_type,
                safe_title,
                safe_summary,
                tone,
                risk_level,
                recommended_next_step,
                source_kind,
                is_sensitive,
                source_reference_id,
                memory_metadata,
                created_at,
                updated_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(user_id),
                    str(conversation_id) if conversation_id else None,
                    memory_type,
                    safe_title,
                    safe_summary,
                    tone,
                    risk_level,
                    recommended_next_step,
                    source_kind,
                    is_sensitive,
                    str(source_reference_id) if source_reference_id else None,
                    _to_json_text(memory_metadata or {}),
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def list_by_user(
        self,
        *,
        user_id: UUID,
        memory_type: str | None = None,
        source_kind: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Mapping[str, Any]]:
        query = """
            SELECT
                id,
                user_id,
                conversation_id,
                memory_type,
                safe_title,
                safe_summary,
                tone,
                risk_level,
                recommended_next_step,
                source_kind,
                is_sensitive,
                source_reference_id,
                memory_metadata,
                created_at,
                updated_at
            FROM memory_items
            WHERE user_id = %s
              AND (%s IS NULL OR memory_type = %s)
              AND (%s IS NULL OR source_kind = %s)
            ORDER BY created_at DESC, updated_at DESC
            LIMIT %s OFFSET %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (str(user_id), memory_type, memory_type, source_kind, source_kind, limit, offset),
            )
            rows = cursor.fetchall()
        return [dict(row) for row in rows]


def _to_json_text(value: Mapping[str, Any]) -> str:
    import json

    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
