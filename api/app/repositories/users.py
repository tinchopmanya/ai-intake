from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class UserRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def upsert_google_user(
        self,
        *,
        google_sub: str,
        email: str,
        display_name: str | None,
        picture_url: str | None,
        locale: str | None,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO users (
                google_sub, email, display_name, picture_url, locale, last_login_at
            )
            VALUES (%s, %s, %s, %s, COALESCE(%s, 'es-LA'), now())
            ON CONFLICT (google_sub)
            DO UPDATE SET
                email = EXCLUDED.email,
                display_name = COALESCE(EXCLUDED.display_name, users.display_name),
                picture_url = COALESCE(EXCLUDED.picture_url, users.picture_url),
                locale = COALESCE(EXCLUDED.locale, users.locale),
                last_login_at = now(),
                updated_at = now()
            RETURNING
                id, email, display_name, memory_opt_in, locale, picture_url
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (google_sub, email, display_name, picture_url, locale),
            )
            row = cursor.fetchone()
        return dict(row)

    def get_by_id(self, *, user_id: UUID) -> Mapping[str, Any] | None:
        query = """
            SELECT id, email, display_name, memory_opt_in, locale, picture_url
            FROM users
            WHERE id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id),))
            row = cursor.fetchone()
        return dict(row) if row else None
