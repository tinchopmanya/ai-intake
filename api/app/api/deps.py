from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from fastapi import Header
from fastapi import HTTPException

from app.db import build_postgres_connection_factory
from app.repositories import TrackingEventRepository
from app.repositories import UnitOfWork
from app.services.auth_service import AuthenticatedUser
from app.services.auth_service import AuthError
from app.services.auth_service import AuthService
from app.services.ocr_service import OcrService
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


def get_current_user(
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> AuthenticatedUser:
    try:
        return auth_service.get_user_from_access_token(authorization)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def get_ocr_service() -> OcrService:
    return OcrService(provider=settings.ocr_provider)

