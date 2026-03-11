from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import advisor_router as advisor_v1_router
from app.api.routers import analysis_router
from app.api.routers import auth_router
from app.api.routers import onboarding_router
from app.api.routers import ocr_router
from config import settings
from repositories.in_memory import conversation_repository
from routers.chat import router as chat_router
from routers.health import router as health_router
from app.services.i18n_service import i18n_service

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(chat_router)
app.include_router(auth_router)
app.include_router(onboarding_router)
app.include_router(analysis_router)
app.include_router(advisor_v1_router)
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
