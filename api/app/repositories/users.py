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
                country_code, language_code, onboarding_completed,
                relationship_mode, user_age, ex_partner_name, ex_partner_pronoun, breakup_time_range,
                children_count_category, relationship_goal, breakup_initiator,
                custody_type, response_style
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
                country_code, language_code, onboarding_completed,
                relationship_mode, user_age, ex_partner_name, ex_partner_pronoun, breakup_time_range,
                children_count_category, relationship_goal, breakup_initiator,
                custody_type, response_style
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
                display_name,
                relationship_mode,
                user_age,
                ex_partner_name,
                ex_partner_pronoun,
                breakup_time_range,
                children_count_category,
                relationship_goal,
                breakup_initiator,
                custody_type,
                response_style,
                country_code,
                language_code,
                onboarding_completed
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
        relationship_mode: str,
        user_name: str,
        user_age: int,
        ex_partner_name: str,
        ex_partner_pronoun: str,
        breakup_time_range: str,
        children_count_category: str,
        relationship_goal: str | None,
        breakup_initiator: str,
        custody_type: str | None,
        response_style: str | None,
        country_code: str,
        language_code: str,
    ) -> Mapping[str, Any] | None:
        locale = f"{language_code}-{country_code}"
        query = """
            UPDATE users
            SET
                display_name = %s,
                relationship_mode = %s,
                user_age = %s,
                ex_partner_name = %s,
                ex_partner_pronoun = %s,
                breakup_time_range = %s,
                children_count_category = %s,
                relationship_goal = %s,
                breakup_initiator = %s,
                custody_type = %s,
                response_style = %s,
                country_code = %s,
                language_code = %s,
                locale = %s,
                onboarding_completed = true,
                updated_at = now()
            WHERE id = %s
            RETURNING
                display_name,
                relationship_mode,
                user_age,
                ex_partner_name,
                ex_partner_pronoun,
                breakup_time_range,
                children_count_category,
                relationship_goal,
                breakup_initiator,
                custody_type,
                response_style,
                country_code,
                language_code,
                onboarding_completed
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    user_name,
                    relationship_mode,
                    user_age,
                    ex_partner_name,
                    ex_partner_pronoun,
                    breakup_time_range,
                    children_count_category,
                    relationship_goal,
                    breakup_initiator,
                    custody_type,
                    response_style,
                    country_code,
                    language_code,
                    locale,
                    str(user_id),
                ),
            )
            row = cursor.fetchone()
        return dict(row) if row else None
