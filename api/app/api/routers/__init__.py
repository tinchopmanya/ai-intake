from .advisor import router as advisor_router
from .analysis import router as analysis_router
from .auth import router as auth_router
from .cases import router as cases_router
from .conversations import router as conversations_router
from .emotional_checkins import router as emotional_checkins_router
from .events import router as events_router
from .incidents import router as incidents_router
from .metrics import router as metrics_router
from .messages import router as messages_router
from .onboarding import router as onboarding_router
from .ocr import router as ocr_router

__all__ = [
    "advisor_router",
    "analysis_router",
    "auth_router",
    "cases_router",
    "conversations_router",
    "emotional_checkins_router",
    "events_router",
    "incidents_router",
    "metrics_router",
    "messages_router",
    "onboarding_router",
    "ocr_router",
]

