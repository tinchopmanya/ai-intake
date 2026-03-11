from .advisor import router as advisor_router
from .analysis import router as analysis_router
from .auth import router as auth_router
from .ocr import router as ocr_router

__all__ = ["advisor_router", "analysis_router", "auth_router", "ocr_router"]

