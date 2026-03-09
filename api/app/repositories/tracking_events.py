from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionFactory


class TrackingEventRepository:
    """
    Best-effort analytics persistence.
    Failures are intentionally swallowed so functional flows do not break.
    """

    def __init__(self, connection_factory: ConnectionFactory) -> None:
        self._connection_factory = connection_factory

    def append(
        self,
        *,
        event_name: str,
        session_id: UUID | None,
        user_id: UUID | None,
        step: str | None = None,
        mode: str | None = None,
        quick_mode: bool | None = None,
        save_session: bool | None = None,
        duration_ms: int | None = None,
        success: bool | None = None,
        error_code: str | None = None,
        properties: Mapping[str, Any] | None = None,
    ) -> bool:
        query = """
            INSERT INTO analytics.wizard_events (
                session_id, user_id, event_name, step, mode, quick_mode,
                save_session, duration_ms, success, error_code, properties
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        """
        payload = _to_json_text(properties or {})
        connection = None
        try:
            connection = self._connection_factory()
            with connection.cursor() as cursor:
                cursor.execute(
                    query,
                    (
                        str(session_id) if session_id else None,
                        str(user_id) if user_id else None,
                        event_name,
                        step,
                        mode,
                        quick_mode,
                        save_session,
                        duration_ms,
                        success,
                        error_code,
                        payload,
                    ),
                )
            connection.commit()
            return True
        except Exception:
            return False
        finally:
            if connection is not None:
                connection.close()


def _to_json_text(value: Mapping[str, Any]) -> str:
    import json

    return json.dumps(value, ensure_ascii=True)

