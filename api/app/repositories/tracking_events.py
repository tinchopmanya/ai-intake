from collections.abc import Mapping
import logging
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionFactory

logger = logging.getLogger(__name__)


class TrackingEventRepository:
    """
    Best-effort analytics persistence.
    Failures are intentionally swallowed so functional flows do not break.
    """

    def __init__(self, connection_factory: ConnectionFactory) -> None:
        self._connection_factory = connection_factory
        self._append_failures = 0

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
            logger.info(
                "event_tracking",
                extra={
                    "event": event_name,
                    "user_id": str(user_id) if user_id else None,
                    "session_id": str(session_id) if session_id else None,
                    "success": bool(success),
                },
            )
            return True
        except Exception as exc:
            self._append_failures += 1
            logger.warning(
                "tracking_append_failed event_name=%s session_id=%s user_id=%s failures=%s error=%s",
                event_name,
                session_id,
                user_id,
                self._append_failures,
                type(exc).__name__,
            )
            logger.info(
                "event_tracking",
                extra={
                    "event": event_name,
                    "user_id": str(user_id) if user_id else None,
                    "session_id": str(session_id) if session_id else None,
                    "success": False,
                },
            )
            return False
        finally:
            if connection is not None:
                connection.close()


def _to_json_text(value: Mapping[str, Any]) -> str:
    import json

    return json.dumps(value, ensure_ascii=True)

