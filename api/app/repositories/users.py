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
        country_code: str | None,
        language_code: str | None,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO users (
                google_sub, email, display_name, picture_url, locale,
                country_code, language_code, last_login_at
            )
            VALUES (
                %s, %s, %s, %s, COALESCE(%s, 'es-LA'),
                COALESCE(%s, 'UY'), COALESCE(%s, 'es'), now()
            )
            ON CONFLICT (google_sub)
            DO UPDATE SET
                email = EXCLUDED.email,
                display_name = COALESCE(EXCLUDED.display_name, users.display_name),
                picture_url = COALESCE(EXCLUDED.picture_url, users.picture_url),
                locale = COALESCE(EXCLUDED.locale, users.locale),
                country_code = COALESCE(EXCLUDED.country_code, users.country_code),
                language_code = COALESCE(EXCLUDED.language_code, users.language_code),
                last_login_at = now(),
                updated_at = now()
            RETURNING
                id, email, display_name, memory_opt_in, locale, picture_url,
                country_code, language_code, onboarding_completed
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    google_sub,
                    email,
                    display_name,
                    picture_url,
                    locale,
                    country_code,
                    language_code,
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def get_by_id(self, *, user_id: UUID) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id, email, display_name, memory_opt_in, locale, picture_url,
                country_code, language_code, onboarding_completed
            FROM users
            WHERE id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id),))
            row = cursor.fetchone()
        return dict(row) if row else None

    def get_onboarding_profile(self, *, user_id: UUID) -> Mapping[str, Any] | None:
        query = """
            SELECT
                objective, has_children, breakup_side,
                country_code, language_code, onboarding_completed
            FROM users
            WHERE id = %s
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (str(user_id),))
            row = cursor.fetchone()
        return dict(row) if row else None

    def update_onboarding_profile(
        self,
        *,
        user_id: UUID,
        objective: str,
        has_children: bool,
        breakup_side: str,
        country_code: str,
        language_code: str,
    ) -> Mapping[str, Any] | None:
        locale = f"{language_code}-{country_code}"
        query = """
            UPDATE users
            SET
                objective = %s,
                has_children = %s,
                breakup_side = %s,
                country_code = %s,
                language_code = %s,
                locale = %s,
                onboarding_completed = true,
                updated_at = now()
            WHERE id = %s
            RETURNING
                objective, has_children, breakup_side,
                country_code, language_code, onboarding_completed
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    objective,
                    has_children,
                    breakup_side,
                    country_code,
                    language_code,
                    locale,
                    str(user_id),
                ),
            )
            row = cursor.fetchone()
        return dict(row) if row else None
