from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

from app.repositories.protocols import ConnectionProtocol


class AuthSessionRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def create(
        self,
        *,
        user_id: UUID,
        access_token_hash: str,
        refresh_token_hash: str,
        access_expires_at: datetime,
        refresh_expires_at: datetime,
    ) -> Mapping[str, Any]:
        query = """
            INSERT INTO auth_sessions (
                user_id, access_token_hash, refresh_token_hash,
                access_expires_at, refresh_expires_at
            )
            VALUES (%s, %s, %s, %s, %s)
            RETURNING
                id, user_id, access_token_hash, refresh_token_hash,
                access_expires_at, refresh_expires_at, revoked_at, last_used_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    str(user_id),
                    access_token_hash,
                    refresh_token_hash,
                    access_expires_at,
                    refresh_expires_at,
                ),
            )
            row = cursor.fetchone()
        return dict(row)

    def get_active_by_refresh_hash(
        self, *, refresh_token_hash: str
    ) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id, user_id, access_token_hash, refresh_token_hash,
                access_expires_at, refresh_expires_at, revoked_at, last_used_at, created_at
            FROM auth_sessions
            WHERE refresh_token_hash = %s
              AND revoked_at IS NULL
              AND refresh_expires_at > now()
            LIMIT 1
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (refresh_token_hash,))
            row = cursor.fetchone()
        return dict(row) if row else None

    def get_active_by_access_hash(self, *, access_token_hash: str) -> Mapping[str, Any] | None:
        query = """
            SELECT
                id, user_id, access_token_hash, refresh_token_hash,
                access_expires_at, refresh_expires_at, revoked_at, last_used_at, created_at
            FROM auth_sessions
            WHERE access_token_hash = %s
              AND revoked_at IS NULL
              AND access_expires_at > now()
            LIMIT 1
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (access_token_hash,))
            row = cursor.fetchone()
        return dict(row) if row else None

    def rotate(
        self,
        *,
        session_id: UUID,
        access_token_hash: str,
        refresh_token_hash: str,
        access_expires_at: datetime,
        refresh_expires_at: datetime,
    ) -> Mapping[str, Any] | None:
        query = """
            UPDATE auth_sessions
            SET
                access_token_hash = %s,
                refresh_token_hash = %s,
                access_expires_at = %s,
                refresh_expires_at = %s,
                last_used_at = now()
            WHERE id = %s
              AND revoked_at IS NULL
            RETURNING
                id, user_id, access_token_hash, refresh_token_hash,
                access_expires_at, refresh_expires_at, revoked_at, last_used_at, created_at
        """
        with self._connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    access_token_hash,
                    refresh_token_hash,
                    access_expires_at,
                    refresh_expires_at,
                    str(session_id),
                ),
            )
            row = cursor.fetchone()
        return dict(row) if row else None

    def revoke_by_refresh_hash(self, *, refresh_token_hash: str) -> bool:
        query = """
            UPDATE auth_sessions
            SET revoked_at = now(), last_used_at = now()
            WHERE refresh_token_hash = %s
              AND revoked_at IS NULL
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query, (refresh_token_hash,))
            rowcount = cursor.rowcount
        return rowcount > 0
