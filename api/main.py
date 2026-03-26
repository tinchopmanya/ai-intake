import logging

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import advisor_router as advisor_v1_router
from app.api.routers import analysis_router
from app.api.routers import auth_router
from app.api.routers import cases_router
from app.api.routers import conversations_router
from app.api.routers import events_router
from app.api.routers import incidents_router
from app.api.routers import metrics_router
from app.api.routers import onboarding_router
from app.api.routers import ocr_router
from app.services.i18n_service import i18n_service
from config import settings
from config import validate_startup_or_raise
from repositories.in_memory import conversation_repository
from routers.chat import router as chat_router
from routers.health import router as health_router

logger = logging.getLogger(__name__)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_validation() -> None:
    validate_startup_or_raise(settings)
    logger.info(
        "Startup validation completed. env=%s local=%s legacy_chat=%s",
        settings.app_env,
        settings.is_local_env,
        settings.enable_legacy_chat_routes,
    )


app.include_router(health_router)
if settings.enable_legacy_chat_routes and not settings.is_validation_env:
    app.include_router(chat_router)
    logger.warning(
        "Legacy compatibility router enabled: /v1/chat and /v1/conversations/* are deprecated."
    )
else:
    if settings.is_validation_env:
        logger.info("Legacy chat router disabled (validation mode).")
    else:
        logger.info("Legacy chat router disabled (ENABLE_LEGACY_CHAT_ROUTES=false).")
app.include_router(auth_router)
app.include_router(onboarding_router)
app.include_router(cases_router)
app.include_router(conversations_router)
app.include_router(incidents_router)
app.include_router(analysis_router)
app.include_router(advisor_v1_router)
app.include_router(events_router)
app.include_router(metrics_router)
app.include_router(ocr_router)


@app.exception_handler(HTTPException)
async def localized_http_exception_handler(
    request: Request,
    exc: HTTPException,
) -> JSONResponse:
    detail = exc.detail
    if not isinstance(detail, str):
        return JSONResponse(status_code=exc.status_code, content={"detail": detail})

    language_code = i18n_service.resolve_language(request.headers.get("accept-language"))
    message = i18n_service.translate_error(detail, language_code=language_code)
    if message == detail:
        return JSONResponse(status_code=exc.status_code, content={"detail": detail})
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": detail,
            "message": message,
            "language_code": language_code,
        },
    )


# Backward compatibility with existing tests/imports.
conversations = conversation_repository.conversations
