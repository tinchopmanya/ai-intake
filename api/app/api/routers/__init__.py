from .advisor import router as advisor_router
from .analysis import router as analysis_router
from .auth import router as auth_router
from .cases import router as cases_router
from .events import router as events_router
from .incidents import router as incidents_router
from .metrics import router as metrics_router
from .onboarding import router as onboarding_router
from .ocr import router as ocr_router

__all__ = [
    "advisor_router",
    "analysis_router",
    "auth_router",
    "cases_router",
    "events_router",
    "incidents_router",
    "metrics_router",
    "onboarding_router",
    "ocr_router",
]

