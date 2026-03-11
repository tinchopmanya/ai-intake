from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import advisor_router as advisor_v1_router
from app.api.routers import analysis_router
from app.api.routers import auth_router
from app.api.routers import ocr_router
from config import settings
from repositories.in_memory import conversation_repository
from routers.chat import router as chat_router
from routers.health import router as health_router

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
app.include_router(analysis_router)
app.include_router(advisor_v1_router)
app.include_router(ocr_router)

# Backward compatibility with existing tests/imports.
conversations = conversation_repository.conversations
