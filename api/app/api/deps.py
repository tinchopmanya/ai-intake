from collections.abc import Iterator

from app.db import build_postgres_connection_factory
from app.repositories import TrackingEventRepository
from app.repositories import UnitOfWork
from app.services.auth_service import AuthService
from config import settings
from providers.base import AIProvider
from providers.factory import build_provider


def get_uow() -> Iterator[UnitOfWork | None]:
    try:
        connection_factory = build_postgres_connection_factory()
    except RuntimeError:
        yield None
        return

    tracking = TrackingEventRepository(connection_factory)
    with UnitOfWork(connection_factory, tracking_repository=tracking) as uow:
        yield uow


def get_ai_provider() -> AIProvider:
    return build_provider()


def get_auth_service() -> AuthService:
    try:
        connection_factory = build_postgres_connection_factory()
    except RuntimeError:
        connection_factory = None

    return AuthService(
        connection_factory=connection_factory,
        google_client_id=settings.google_client_id,
        access_ttl_seconds=settings.auth_access_ttl_seconds,
        refresh_ttl_seconds=settings.auth_refresh_ttl_seconds,
    )

