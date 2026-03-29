from __future__ import annotations

import hashlib
import logging
import secrets
import sys
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

logger = logging.getLogger(__name__)
GOOGLE_TOKEN_VERIFY_TIMEOUT_SECONDS = 8.0


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
    country_code: str
    language_code: str
    onboarding_completed: bool
    relationship_mode: str | None = None
    user_age: int | None = None
    ex_partner_name: str | None = None
    ex_partner_pronoun: str | None = None
    breakup_time_range: str | None = None
    children_count_category: str | None = None
    relationship_goal: str | None = None
    breakup_initiator: str | None = None
    custody_type: str | None = None
    response_style: str | None = None


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
        try:
            google_claims = self._verify_google_id_token(id_token_value)
            user = self._upsert_google_user(google_claims)
            tokens = self._issue_session(user.id)
            return tokens, user
        except AuthError:
            raise
        except Exception as exc:
            logger.exception("Unexpected sign-in failure in Google auth flow: %s", exc)
            raise AuthError(status_code=500, detail="auth_internal_error") from exc

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

        connection = self._open_connection(operation="logout")
        try:
            sessions = AuthSessionRepository(connection)
            revoked = sessions.revoke_by_refresh_hash(refresh_token_hash=refresh_hash)
            connection.commit()
            return revoked
        except Exception as exc:
            try:
                connection.rollback()
            except Exception:
                pass
            logger.exception("Failed to revoke auth session in DB: %s", exc)
            if _is_db_connection_error(exc):
                raise AuthError(status_code=503, detail="database_unavailable") from exc
            raise AuthError(status_code=500, detail="auth_internal_error") from exc
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

        try:
            connection = self._connection_factory()
        except Exception as exc:
            logger.exception("Failed to open DB connection while validating access token: %s", exc)
            if _is_db_connection_error(exc) or isinstance(exc, RuntimeError):
                raise AuthError(status_code=503, detail="database_unavailable") from exc
            raise
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
        if not self._google_client_id:
            raise AuthError(status_code=400, detail="google_client_id_not_configured")

        try:
            from google.auth.transport import requests as google_requests
            from google.oauth2 import id_token as google_id_token
        except ImportError as exc:
            logger.exception(
                "Google auth import failed. Missing dependency or wrong interpreter. "
                "python=%s error=%r",
                sys.executable,
                exc,
            )
            raise AuthError(status_code=503, detail="google_auth_library_missing") from exc
        except Exception as exc:
            logger.exception(
                "Unexpected exception importing google auth modules. "
                "python=%s error=%r",
                sys.executable,
                exc,
            )
            raise AuthError(status_code=503, detail="google_auth_library_missing") from exc

        try:
            base_request = google_requests.Request()

            class GoogleRequestWithTimeout:
                def __init__(self, request_impl: Any) -> None:
                    self._request_impl = request_impl

                def __call__(self, *args: Any, **kwargs: Any) -> Any:
                    kwargs.setdefault("timeout", GOOGLE_TOKEN_VERIFY_TIMEOUT_SECONDS)
                    return self._request_impl(*args, **kwargs)

            request = GoogleRequestWithTimeout(base_request)
            claims: dict[str, Any] = google_id_token.verify_oauth2_token(
                id_token_value,
                request,
                audience=self._google_client_id,
            )
        except Exception as exc:
            normalized_error = str(exc).strip().lower()
            if "timeout" in normalized_error or "timed out" in normalized_error:
                logger.warning("Google token verification timed out: %s", exc)
                raise AuthError(status_code=503, detail="google_token_verification_timeout") from exc
            if "transport" in normalized_error or "certificate" in normalized_error:
                logger.warning("Google token verification unavailable: %s", exc)
                raise AuthError(status_code=503, detail="google_token_verification_unavailable") from exc
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
        language_code, country_code = _parse_locale(locale)

        if self._connection_factory is None:
            logger.warning(
                "Auth running in memory mode: DATABASE_URL missing; user will not persist."
            )
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
                        country_code=country_code or existing.country_code,
                        language_code=language_code or existing.language_code,
                        onboarding_completed=existing.onboarding_completed,
                        user_age=existing.user_age,
                        ex_partner_name=existing.ex_partner_name,
                        ex_partner_pronoun=existing.ex_partner_pronoun,
                        breakup_time_range=existing.breakup_time_range,
                        relationship_mode=existing.relationship_mode,
                        children_count_category=existing.children_count_category,
                        relationship_goal=existing.relationship_goal,
                        breakup_initiator=existing.breakup_initiator,
                        custody_type=existing.custody_type,
                        response_style=existing.response_style,
                    )
                else:
                    user = AuthenticatedUser(
                        id=uuid4(),
                        email=email,
                        name=display_name,
                        memory_opt_in=False,
                        locale=locale or "es-LA",
                        picture_url=picture_url,
                        country_code=country_code,
                        language_code=language_code,
                        onboarding_completed=False,
                        user_age=None,
                        ex_partner_name=None,
                        ex_partner_pronoun=None,
                        breakup_time_range=None,
                        relationship_mode=None,
                        children_count_category=None,
                        relationship_goal=None,
                        breakup_initiator=None,
                        custody_type=None,
                        response_style=None,
                    )
                self._memory_users_by_sub[google_sub] = user
                self._memory_users_by_id[user.id] = user
                return user

        try:
            connection = self._connection_factory()
        except Exception as exc:
            logger.exception("Failed to open DB connection for Google user upsert: %s", exc)
            raise AuthError(status_code=503, detail="database_unavailable") from exc

        try:
            users = UserRepository(connection)
            row = users.upsert_google_user(
                google_sub=google_sub,
                email=email,
                display_name=display_name,
                picture_url=picture_url,
                locale=locale,
                country_code=country_code,
                language_code=language_code,
            )
            connection.commit()
            return _map_user_row(row)
        except Exception as exc:
            try:
                connection.rollback()
            except Exception:
                pass
            logger.exception("Failed to persist Google user in DB: %s", exc)
            if _is_db_connection_error(exc):
                raise AuthError(status_code=503, detail="database_unavailable") from exc
            raise AuthError(status_code=503, detail="user_persistence_failed") from exc
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
            try:
                connection = self._connection_factory()
            except Exception as exc:
                logger.exception("Failed to open DB connection for auth session create: %s", exc)
                raise AuthError(status_code=503, detail="database_unavailable") from exc
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
            except Exception as exc:
                try:
                    connection.rollback()
                except Exception:
                    pass
                logger.exception("Failed to persist auth session in DB: %s", exc)
                if _is_db_connection_error(exc):
                    raise AuthError(status_code=503, detail="database_unavailable") from exc
                raise AuthError(status_code=503, detail="session_persistence_failed") from exc
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
        connection_factory = self._connection_factory
        if connection_factory is None:
            raise AuthError(status_code=500, detail="auth_service_misconfigured")

        try:
            db = connection_factory()
        except Exception as exc:
            logger.exception("Failed to open DB connection for refresh_session: %s", exc)
            raise AuthError(status_code=503, detail="database_unavailable") from exc
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
        except AuthError:
            raise
        except Exception as exc:
            try:
                db.rollback()
            except Exception:
                pass
            logger.exception("Failed to refresh auth session in DB: %s", exc)
            if _is_db_connection_error(exc):
                raise AuthError(status_code=503, detail="database_unavailable") from exc
            raise AuthError(status_code=500, detail="auth_internal_error") from exc
        finally:
            db.close()

    def get_onboarding_profile(self, *, user_id: UUID) -> dict[str, object]:
        if self._connection_factory is None:
            with self._memory_lock:
                user = self._memory_users_by_id.get(user_id)
                if user is None:
                    raise AuthError(status_code=404, detail="user_not_found")
                return {
                    "display_name": user.name,
                    "relationship_mode": user.relationship_mode,
                    "user_age": user.user_age,
                    "ex_partner_name": user.ex_partner_name,
                    "ex_partner_pronoun": user.ex_partner_pronoun,
                    "breakup_time_range": user.breakup_time_range,
                    "children_count_category": user.children_count_category,
                    "relationship_goal": user.relationship_goal,
                    "breakup_initiator": user.breakup_initiator,
                    "custody_type": user.custody_type,
                    "response_style": user.response_style,
                    "country_code": user.country_code,
                    "language_code": user.language_code,
                    "onboarding_completed": _is_onboarding_profile_complete(
                        {
                            "display_name": user.name,
                            "relationship_mode": user.relationship_mode,
                            "user_age": user.user_age,
                            "ex_partner_name": user.ex_partner_name,
                            "ex_partner_pronoun": user.ex_partner_pronoun,
                            "breakup_time_range": user.breakup_time_range,
                            "children_count_category": user.children_count_category,
                            "relationship_goal": user.relationship_goal,
                            "breakup_initiator": user.breakup_initiator,
                            "custody_type": user.custody_type,
                            "response_style": user.response_style,
                        }
                    ),
                }

        connection = self._open_connection(operation="get_onboarding_profile")
        try:
            users = UserRepository(connection)
            profile = users.get_onboarding_profile(user_id=user_id)
            if profile is None:
                raise AuthError(status_code=404, detail="user_not_found")
            profile["onboarding_completed"] = bool(
                profile.get("onboarding_completed", False)
            ) and _is_onboarding_profile_complete(
                profile
            )
            return profile
        except AuthError:
            raise
        except Exception as exc:
            logger.exception("Failed to fetch onboarding profile from DB: %s", exc)
            if _is_db_connection_error(exc):
                raise AuthError(status_code=503, detail="database_unavailable") from exc
            raise AuthError(status_code=500, detail="auth_internal_error") from exc
        finally:
            connection.close()

    def update_onboarding_profile(
        self,
        *,
        user_id: UUID,
        user_name: str,
        user_age: int,
        ex_partner_name: str,
        ex_partner_pronoun: str,
        breakup_time_range: str,
        relationship_mode: str,
        children_count_category: str,
        relationship_goal: str | None,
        breakup_initiator: str,
        custody_type: str | None,
        response_style: str | None,
        country_code: str,
        language_code: str,
    ) -> dict[str, object]:
        normalized_country = country_code.upper()
        normalized_language = language_code.lower()
        if normalized_language not in {"es", "en", "pt"}:
            raise AuthError(status_code=400, detail="invalid_language_code")

        if self._connection_factory is None:
            with self._memory_lock:
                user = self._memory_users_by_id.get(user_id)
                if user is None:
                    raise AuthError(status_code=404, detail="user_not_found")
                updated = AuthenticatedUser(
                    id=user.id,
                    email=user.email,
                    name=user_name,
                    memory_opt_in=user.memory_opt_in,
                    locale=f"{normalized_language}-{normalized_country}",
                    picture_url=user.picture_url,
                    country_code=normalized_country,
                    language_code=normalized_language,
                    onboarding_completed=True,
                    relationship_mode=relationship_mode,
                    user_age=user_age,
                    ex_partner_name=ex_partner_name,
                    ex_partner_pronoun=ex_partner_pronoun,
                    breakup_time_range=breakup_time_range,
                    children_count_category=children_count_category,
                    relationship_goal=relationship_goal,
                    breakup_initiator=breakup_initiator,
                    custody_type=custody_type,
                    response_style=response_style,
                )
                self._memory_users_by_id[user_id] = updated
                for google_sub, cached_user in list(self._memory_users_by_sub.items()):
                    if cached_user.id == user_id:
                        self._memory_users_by_sub[google_sub] = updated
                return {
                    "display_name": updated.name,
                    "relationship_mode": updated.relationship_mode,
                    "user_age": updated.user_age,
                    "ex_partner_name": updated.ex_partner_name,
                    "ex_partner_pronoun": updated.ex_partner_pronoun,
                    "breakup_time_range": updated.breakup_time_range,
                    "children_count_category": updated.children_count_category,
                    "relationship_goal": updated.relationship_goal,
                    "breakup_initiator": updated.breakup_initiator,
                    "custody_type": updated.custody_type,
                    "response_style": updated.response_style,
                    "country_code": updated.country_code,
                    "language_code": updated.language_code,
                    "onboarding_completed": updated.onboarding_completed,
                }

        connection = self._open_connection(operation="update_onboarding_profile")
        try:
            users = UserRepository(connection)
            updated = users.update_onboarding_profile(
                user_id=user_id,
                relationship_mode=relationship_mode,
                user_name=user_name,
                user_age=user_age,
                ex_partner_name=ex_partner_name,
                ex_partner_pronoun=ex_partner_pronoun,
                breakup_time_range=breakup_time_range,
                children_count_category=children_count_category,
                relationship_goal=relationship_goal,
                breakup_initiator=breakup_initiator,
                custody_type=custody_type,
                response_style=response_style,
                country_code=normalized_country,
                language_code=normalized_language,
            )
            if updated is None:
                raise AuthError(status_code=404, detail="user_not_found")
            connection.commit()
            return updated
        except AuthError:
            raise
        except Exception as exc:
            try:
                connection.rollback()
            except Exception:
                pass
            logger.exception("Failed to persist onboarding profile in DB: %s", exc)
            if _is_db_connection_error(exc):
                raise AuthError(status_code=503, detail="database_unavailable") from exc
            raise AuthError(status_code=500, detail="auth_internal_error") from exc
        finally:
            connection.close()

    def _open_connection(self, *, operation: str):
        connection_factory = self._connection_factory
        if connection_factory is None:
            raise AuthError(status_code=500, detail="auth_service_misconfigured")
        try:
            return connection_factory()
        except Exception as exc:
            logger.exception("Failed to open DB connection for %s: %s", operation, exc)
            raise AuthError(status_code=503, detail="database_unavailable") from exc


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
    relationship_mode = row.get("relationship_mode")
    children_count_category = row.get("children_count_category")
    onboarding_completed = bool(row.get("onboarding_completed", False)) and _is_onboarding_profile_complete(
        {
            "display_name": row.get("display_name"),
            "relationship_mode": relationship_mode,
            "user_age": row.get("user_age"),
            "ex_partner_name": row.get("ex_partner_name"),
            "ex_partner_pronoun": row.get("ex_partner_pronoun"),
            "breakup_time_range": row.get("breakup_time_range"),
            "children_count_category": children_count_category,
            "relationship_goal": row.get("relationship_goal"),
            "breakup_initiator": row.get("breakup_initiator"),
            "custody_type": row.get("custody_type"),
            "response_style": row.get("response_style"),
        }
    )
    return AuthenticatedUser(
        id=UUID(str(row["id"])),
        email=str(row["email"]),
        name=row.get("display_name"),
        memory_opt_in=bool(row.get("memory_opt_in", False)),
        locale=row.get("locale"),
        picture_url=row.get("picture_url"),
        country_code=str(row.get("country_code") or "UY"),
        language_code=str(row.get("language_code") or "es"),
        onboarding_completed=onboarding_completed,
        relationship_mode=relationship_mode,
        user_age=row.get("user_age"),
        ex_partner_name=row.get("ex_partner_name"),
        ex_partner_pronoun=row.get("ex_partner_pronoun"),
        breakup_time_range=row.get("breakup_time_range"),
        children_count_category=children_count_category,
        relationship_goal=row.get("relationship_goal"),
        breakup_initiator=row.get("breakup_initiator"),
        custody_type=row.get("custody_type"),
        response_style=row.get("response_style"),
    )


def _parse_locale(value: str | None) -> tuple[str, str]:
    if not value:
        return "es", "UY"
    normalized = value.replace("_", "-").strip().lower()
    parts = [part for part in normalized.split("-") if part]
    language = parts[0] if parts else "es"
    if language not in {"es", "en", "pt"}:
        language = "es"
    country = "UY"
    if len(parts) >= 2 and len(parts[1]) in {2, 3} and parts[1].isalpha():
        country = parts[1].upper()[:2]
    return language, country


def _is_db_connection_error(exc: Exception) -> bool:
    type_name = type(exc).__name__.lower()
    module_name = type(exc).__module__.lower()
    message = str(exc).lower()
    if "operationalerror" in type_name or "interfaceerror" in type_name:
        return True
    if "psycopg" in module_name and (
        "connection" in message or "connect" in message or "could not" in message
    ):
        return True
    return False


def _is_onboarding_profile_complete(profile: dict[str, Any]) -> bool:
    required_base = (
        profile.get("display_name"),
        profile.get("relationship_mode"),
        profile.get("user_age"),
        profile.get("ex_partner_name"),
        profile.get("ex_partner_pronoun"),
        profile.get("breakup_time_range"),
        profile.get("breakup_initiator"),
    )
    if any(value in (None, "") for value in required_base):
        return False

    mode = profile.get("relationship_mode")
    children_count_category = profile.get("children_count_category")
    if mode == "coparenting":
        if children_count_category not in {"one", "two_plus"}:
            return False
        if profile.get("custody_type") in (None, ""):
            return False
        if profile.get("response_style") in (None, ""):
            return False
        return True

    if mode != "relationship_separation":
        return False
    if children_count_category != "none":
        return False
    return profile.get("relationship_goal") not in (None, "")
