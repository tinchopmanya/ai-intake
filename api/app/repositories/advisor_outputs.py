from collections.abc import Iterable
from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class AdvisorOutputRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def create_one(
        self,
        *,
        session_id: UUID,
        step: str,
        prompt_version: str,
        emotion_label: str,
        output_text: str | None,
        output_json: dict[str, Any] | None,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO advisor_outputs (
                session_id, step, prompt_version, emotion_label, output_text, output_json
            )
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id, session_id, step, prompt_version, emotion_label, output_text, output_json, created_at
        """
        output_payload = output_json if output_json is not None else {}
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(session_id),
                    step,
                    prompt_version,
                    emotion_label,
                    output_text,
                    _to_json_text(output_payload),
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def bulk_create(
        self,
        *,
        session_id: UUID,
        outputs: Iterable[Mapping[str, Any]],
    ) -> list[Mapping[str, Any]]:
        created: list[Mapping[str, Any]] = []
        for output in outputs:
            created.append(
                self.create_one(
                    session_id=session_id,
                    step=str(output["step"]),
                    prompt_version=str(output["prompt_version"]),
                    emotion_label=str(output["emotion_label"]),
                    output_text=output.get("output_text"),
                    output_json=output.get("output_json"),
                )
            )
        return created

    def list_by_session(
        self,
        *,
        session_id: UUID,
    ) -> list[Mapping[str, Any]]:
        query = """
            SELECT id, session_id, step, prompt_version, emotion_label, output_text, output_json, created_at
            FROM advisor_outputs
            WHERE session_id = %s
            ORDER BY created_at ASC
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(session_id),))
            rows = cursor.fetchall()
        return [dict(row) for row in rows]


def _to_json_text(value: Mapping[str, Any]) -> str:
    import json

    return json.dumps(value, ensure_ascii=True)

