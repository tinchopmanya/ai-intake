from collections.abc import Iterator
import logging
from typing import Annotated

from fastapi import Depends
from fastapi import Header
from fastapi import HTTPException

from app.db import build_postgres_connection_factory
from app.repositories import TrackingEventRepository
from app.repositories import UnitOfWork
from app.repositories.protocols import ConnectionFactory
from app.services.auth_service import AuthenticatedUser
from app.services.auth_service import AuthError
from app.services.auth_service import AuthService
from app.services.advisor_catalog_service import AdvisorCatalogService
from app.services.ocr_service import OcrService
from config import settings
from providers.base import AIProvider
from providers.factory import build_provider

logger = logging.getLogger(__name__)
_fallback_log_once: set[str] = set()


def _warn_once(key: str, message: str, *args) -> None:
    if key in _fallback_log_once:
        return
    _fallback_log_once.add(key)
    logger.warning(message, *args)


def _build_connection_factory(*, caller: str) -> ConnectionFactory | None:
    allow_fallback = settings.is_local_env and settings.allow_inmemory_fallback and not settings.is_validation_env
    try:
        connection_factory = build_postgres_connection_factory()
    except RuntimeError as exc:
        if allow_fallback:
            _warn_once(
                f"{caller}:missing_database_url",
                "%s: DATABASE_URL missing. Using explicit in-memory fallback.",
                caller,
            )
            return None
        logger.error("%s: DATABASE_URL is required in this environment.", caller)
        raise HTTPException(status_code=503, detail="database_unavailable") from exc

    try:
        probe = connection_factory()
    except Exception as exc:
        if allow_fallback:
            _warn_once(
                f"{caller}:postgres_probe_failed",
                "%s: PostgreSQL unavailable in local env. Using in-memory fallback. error=%s",
                caller,
                exc,
            )
            return None
        logger.exception("%s: PostgreSQL probe failed.", caller)
        raise HTTPException(status_code=503, detail="database_unavailable") from exc

    try:
        probe.close()
    except Exception:
        pass

    return connection_factory


def get_uow() -> Iterator[UnitOfWork | None]:
    connection_factory = _build_connection_factory(caller="get_uow")
    if connection_factory is None:
        yield None
        return

    tracking = TrackingEventRepository(connection_factory)
    with UnitOfWork(connection_factory, tracking_repository=tracking) as uow:
        yield uow


def get_ai_provider() -> AIProvider:
    return build_provider()


def get_auth_service() -> AuthService:
    connection_factory = _build_connection_factory(caller="get_auth_service")
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
    return OcrService(
        provider=settings.ocr_provider,
        tesseract_cmd=settings.ocr_tesseract_cmd,
        tesseract_lang=settings.ocr_tesseract_lang,
        tesseract_psm=settings.ocr_tesseract_psm,
        tesseract_oem=settings.ocr_tesseract_oem,
        whatsapp_crop_top_px=settings.ocr_whatsapp_crop_top_px,
        whatsapp_crop_bottom_px=settings.ocr_whatsapp_crop_bottom_px,
        wa_top_crop_ratio=settings.ocr_wa_top_crop_ratio,
        wa_bottom_crop_ratio=settings.ocr_wa_bottom_crop_ratio,
        whatsapp_crop_enabled=settings.ocr_whatsapp_crop_enabled,
        turn_detection_enabled=settings.ocr_turn_detection_enabled,
    )


def get_advisor_catalog_service() -> AdvisorCatalogService:
    return AdvisorCatalogService()

