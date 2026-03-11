from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status

from app.api.deps import get_current_user
from app.api.deps import get_ocr_service
from app.schemas.ocr import OcrExtractResponse
from app.services.auth_service import AuthenticatedUser
from app.services.ocr_service import OcrError
from app.services.ocr_service import OcrService
from config import settings

router = APIRouter(prefix="/v1/ocr", tags=["ocr"])

try:
    import multipart  # type: ignore # noqa: F401

    _HAS_MULTIPART = True
except Exception:
    _HAS_MULTIPART = False


if _HAS_MULTIPART:

    @router.post(
        "/extract",
        response_model=OcrExtractResponse,
        status_code=status.HTTP_200_OK,
    )
    async def extract_text_from_image(
        _: Annotated[AuthenticatedUser, Depends(get_current_user)],
        ocr_service: Annotated[OcrService, Depends(get_ocr_service)],
        file: UploadFile = File(...),
    ) -> OcrExtractResponse:
        """Extract text from uploaded conversation screenshot using OCR."""
        content_type = (file.content_type or "").lower()
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="file_must_be_image")

        payload = await file.read()
        if not payload:
            raise HTTPException(status_code=400, detail="empty_file")
        if len(payload) > settings.ocr_max_file_bytes:
            raise HTTPException(status_code=413, detail="file_too_large")

        try:
            result = ocr_service.extract_text(payload)
        except OcrError as exc:
            raise HTTPException(status_code=422, detail=exc.detail) from exc

        return OcrExtractResponse(
            extracted_text=result.extracted_text,
            provider=result.provider,
            confidence=result.confidence,
            warnings=result.warnings,
        )

else:

    @router.post(
        "/extract",
        response_model=OcrExtractResponse,
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    )
    async def extract_text_from_image_dependency_missing(
        _: Annotated[AuthenticatedUser, Depends(get_current_user)],
    ) -> OcrExtractResponse:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="python_multipart_not_installed",
        )
