from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from threading import Lock
from typing import Any
from uuid import UUID
from uuid import uuid4

from app.repositories.auth_sessions import AuthSessionRepository
from app.repositories.protocols import ConnectionFactory
from app.repositories.users import UserRepository


class AuthError(Exception):
    def __init__(self, *, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class AuthenticatedUser:
    id: UUID
    email: str
    name: str | None
    memory_opt_in: bool
    locale: str | None
    picture_url: str | None


@dataclass(frozen=True)
class SessionTokens:
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int
    refresh_expires_in: int


@dataclass
class _MemorySession:
    id: UUID
    user_id: UUID
    access_token_hash: str
    refresh_token_hash: str
    access_expires_at: datetime
    refresh_expires_at: datetime
    revoked_at: datetime | None = None


class AuthService:
    _memory_lock = Lock()
    _memory_users_by_sub: dict[str, AuthenticatedUser] = {}
    _memory_users_by_id: dict[UUID, AuthenticatedUser] = {}
    _memory_sessions_by_refresh: dict[str, _MemorySession] = {}
    _memory_sessions_by_access: dict[str, _MemorySession] = {}

    def __init__(
        self,
        *,
        connection_factory: ConnectionFactory | None,
        google_client_id: str | None,
        access_ttl_seconds: int = 900,
        refresh_ttl_seconds: int = 60 * 60 * 24 * 30,
    ) -> None:
        self._connection_factory = connection_factory
        self._google_client_id = google_client_id
        self._access_ttl = max(access_ttl_seconds, 60)
        self._refresh_ttl = max(refresh_ttl_seconds, 600)

    def sign_in_with_google(self, id_token_value: str) -> tuple[SessionTokens, AuthenticatedUser]:
        google_claims = self._verify_google_id_token(id_token_value)
        user = self._upsert_google_user(google_claims)
        tokens = self._issue_session(user.id)
        return tokens, user

    def refresh_session(self, refresh_token: str) -> tuple[SessionTokens, AuthenticatedUser]:
        refresh_hash = _hash_token(refresh_token)
        if self._connection_factory is None:
            return self._refresh_session_in_memory(refresh_hash)
        return self._refresh_session_in_db(refresh_hash)

    def logout(self, refresh_token: str) -> bool:
        refresh_hash = _hash_token(refresh_token)
        if self._connection_factory is None:
            with self._memory_lock:
                session = self._memory_sessions_by_refresh.get(refresh_hash)
                if session is None or session.revoked_at is not None:
                    return False
                session.revoked_at = datetime.now(UTC)
                return True

        connection = self._connection_factory()
        try:
            sessions = AuthSessionRepository(connection)
            revoked = sessions.revoke_by_refresh_hash(refresh_token_hash=refresh_hash)
            connection.commit()
            return revoked
        finally:
            connection.close()

    def get_user_from_access_token(self, bearer_header: str | None) -> AuthenticatedUser:
        token = _extract_bearer_token(bearer_header)
        if token is None:
            raise AuthError(status_code=401, detail="missing_bearer_token")
        access_hash = _hash_token(token)

        if self._connection_factory is None:
            with self._memory_lock:
                session = self._memory_sessions_by_access.get(access_hash)
                if session is None:
                    raise AuthError(status_code=401, detail="invalid_or_expired_session")
                now = datetime.now(UTC)
                if session.revoked_at is not None or session.access_expires_at <= now:
                    raise AuthError(status_code=401, detail="invalid_or_expired_session")
                user = self._memory_users_by_id.get(session.user_id)
                if user is None:
                    raise AuthError(status_code=401, detail="invalid_or_expired_session")
                return user

        connection = self._connection_factory()
        try:
            sessions = AuthSessionRepository(connection)
            users = UserRepository(connection)
            session = sessions.get_active_by_access_hash(access_token_hash=access_hash)
            if session is None:
                raise AuthError(status_code=401, detail="invalid_or_expired_session")
            user_row = users.get_by_id(user_id=UUID(str(session["user_id"])))
            if user_row is None:
                raise AuthError(status_code=401, detail="invalid_or_expired_session")
            return _map_user_row(user_row)
        finally:
            connection.close()

    def _verify_google_id_token(self, id_token_value: str) -> dict[str, Any]:
        try:
            from google.auth.transport import requests as google_requests
            from google.oauth2 import id_token as google_id_token
        except Exception as exc:
            raise AuthError(status_code=500, detail="google_auth_library_missing") from exc

        try:
            request = google_requests.Request()
            claims: dict[str, Any] = google_id_token.verify_oauth2_token(
                id_token_value,
                request,
                audience=self._google_client_id if self._google_client_id else None,
            )
        except Exception as exc:
            raise AuthError(status_code=401, detail="invalid_google_token") from exc

        issuer = str(claims.get("iss", ""))
        if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
            raise AuthError(status_code=401, detail="invalid_google_token")

        google_sub = str(claims.get("sub") or "").strip()
        email = str(claims.get("email") or "").strip().lower()
        if not google_sub or not email:
            raise AuthError(status_code=401, detail="invalid_google_token")
        if claims.get("email_verified") is False:
            raise AuthError(status_code=401, detail="google_email_not_verified")
        return claims

    def _upsert_google_user(self, claims: dict[str, Any]) -> AuthenticatedUser:
        google_sub = str(claims.get("sub"))
        email = str(claims.get("email")).lower()
        display_name = str(claims.get("name") or "").strip() or None
        picture_url = str(claims.get("picture") or "").strip() or None
        locale = str(claims.get("locale") or "").strip() or None

        if self._connection_factory is None:
            with self._memory_lock:
                existing = self._memory_users_by_sub.get(google_sub)
                if existing is not None:
                    user = AuthenticatedUser(
                        id=existing.id,
                        email=email,
                        name=display_name or existing.name,
                        memory_opt_in=existing.memory_opt_in,
                        locale=locale or existing.locale,
                        picture_url=picture_url or existing.picture_url,
                    )
                else:
                    user = AuthenticatedUser(
                        id=uuid4(),
                        email=email,
                        name=display_name,
                        memory_opt_in=False,
                        locale=locale or "es-LA",
                        picture_url=picture_url,
                    )
                self._memory_users_by_sub[google_sub] = user
                self._memory_users_by_id[user.id] = user
                return user

        connection = self._connection_factory()
        try:
            users = UserRepository(connection)
            row = users.upsert_google_user(
                google_sub=google_sub,
                email=email,
                display_name=display_name,
                picture_url=picture_url,
                locale=locale,
            )
            connection.commit()
            return _map_user_row(row)
        finally:
            connection.close()

    def _issue_session(self, user_id: UUID) -> SessionTokens:
        now = datetime.now(UTC)
        access_expires_at = now + timedelta(seconds=self._access_ttl)
        refresh_expires_at = now + timedelta(seconds=self._refresh_ttl)
        access_token = _new_session_token()
        refresh_token = _new_session_token()
        access_hash = _hash_token(access_token)
        refresh_hash = _hash_token(refresh_token)

        if self._connection_factory is None:
            with self._memory_lock:
                session = _MemorySession(
                    id=uuid4(),
                    user_id=user_id,
                    access_token_hash=access_hash,
                    refresh_token_hash=refresh_hash,
                    access_expires_at=access_expires_at,
                    refresh_expires_at=refresh_expires_at,
                )
                self._memory_sessions_by_refresh[refresh_hash] = session
                self._memory_sessions_by_access[access_hash] = session
        else:
            connection = self._connection_factory()
            try:
                sessions = AuthSessionRepository(connection)
                sessions.create(
                    user_id=user_id,
                    access_token_hash=access_hash,
                    refresh_token_hash=refresh_hash,
                    access_expires_at=access_expires_at,
                    refresh_expires_at=refresh_expires_at,
                )
                connection.commit()
            finally:
                connection.close()

        return SessionTokens(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=self._access_ttl,
            refresh_expires_in=self._refresh_ttl,
        )

    def _refresh_session_in_memory(
        self, refresh_hash: str
    ) -> tuple[SessionTokens, AuthenticatedUser]:
        with self._memory_lock:
            session = self._memory_sessions_by_refresh.get(refresh_hash)
            now = datetime.now(UTC)
            if session is None or session.revoked_at is not None or session.refresh_expires_at <= now:
                raise AuthError(status_code=401, detail="invalid_refresh_token")
            user = self._memory_users_by_id.get(session.user_id)
            if user is None:
                raise AuthError(status_code=401, detail="invalid_refresh_token")

            access_token = _new_session_token()
            new_refresh_token = _new_session_token()
            new_access_hash = _hash_token(access_token)
            new_refresh_hash = _hash_token(new_refresh_token)
            self._memory_sessions_by_access.pop(session.access_token_hash, None)
            session.access_token_hash = new_access_hash
            session.refresh_token_hash = new_refresh_hash
            session.access_expires_at = now + timedelta(seconds=self._access_ttl)
            session.refresh_expires_at = now + timedelta(seconds=self._refresh_ttl)
            self._memory_sessions_by_refresh.pop(refresh_hash, None)
            self._memory_sessions_by_refresh[new_refresh_hash] = session
            self._memory_sessions_by_access[new_access_hash] = session

            tokens = SessionTokens(
                access_token=access_token,
                refresh_token=new_refresh_token,
                token_type="bearer",
                expires_in=self._access_ttl,
                refresh_expires_in=self._refresh_ttl,
            )
            return tokens, user

    def _refresh_session_in_db(
        self, refresh_hash: str
    ) -> tuple[SessionTokens, AuthenticatedUser]:
        connection = self._connection_factory
        if connection is None:
            raise AuthError(status_code=500, detail="auth_service_misconfigured")

        db = connection()
        try:
            sessions = AuthSessionRepository(db)
            users = UserRepository(db)
            session = sessions.get_active_by_refresh_hash(refresh_token_hash=refresh_hash)
            if session is None:
                raise AuthError(status_code=401, detail="invalid_refresh_token")

            access_token = _new_session_token()
            new_refresh_token = _new_session_token()
            now = datetime.now(UTC)
            rotated = sessions.rotate(
                session_id=UUID(str(session["id"])),
                access_token_hash=_hash_token(access_token),
                refresh_token_hash=_hash_token(new_refresh_token),
                access_expires_at=now + timedelta(seconds=self._access_ttl),
                refresh_expires_at=now + timedelta(seconds=self._refresh_ttl),
            )
            if rotated is None:
                raise AuthError(status_code=401, detail="invalid_refresh_token")

            user_row = users.get_by_id(user_id=UUID(str(rotated["user_id"])))
            if user_row is None:
                raise AuthError(status_code=401, detail="invalid_refresh_token")
            db.commit()
            tokens = SessionTokens(
                access_token=access_token,
                refresh_token=new_refresh_token,
                token_type="bearer",
                expires_in=self._access_ttl,
                refresh_expires_in=self._refresh_ttl,
            )
            return tokens, _map_user_row(user_row)
        finally:
            db.close()


def _new_session_token() -> str:
    return secrets.token_urlsafe(48)


def _hash_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _extract_bearer_token(bearer_header: str | None) -> str | None:
    if not bearer_header:
        return None
    parts = bearer_header.strip().split(" ", maxsplit=1)
    if len(parts) != 2:
        return None
    if parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _map_user_row(row: dict[str, Any]) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=UUID(str(row["id"])),
        email=str(row["email"]),
        name=row.get("display_name"),
        memory_opt_in=bool(row.get("memory_opt_in", False)),
        locale=row.get("locale"),
        picture_url=row.get("picture_url"),
    )
