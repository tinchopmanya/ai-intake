from typing import Annotated
import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import Header
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status
from pydantic import ValidationError

from app.api.deps import get_auth_service
from app.api.deps import get_current_user
from app.api.deps import get_ocr_service
from app.schemas.ocr import OcrCapabilitiesResponse
from app.schemas.ocr import OcrConversationTurn
from app.schemas.ocr import OcrExtractResponse
from app.services.auth_service import AuthError
from app.services.auth_service import AuthenticatedUser
from app.services.auth_service import AuthService
from app.services.ocr_service import OcrError
from app.services.ocr_service import OcrService
from config import settings

router = APIRouter(prefix="/v1/ocr", tags=["ocr"])
logger = logging.getLogger(__name__)

try:
    import multipart  # type: ignore # noqa: F401

    _HAS_MULTIPART = True
except Exception:
    _HAS_MULTIPART = False


@router.get(
    "/capabilities",
    response_model=OcrCapabilitiesResponse,
    status_code=status.HTTP_200_OK,
)
async def ocr_capabilities(
    ocr_service: Annotated[OcrService, Depends(get_ocr_service)],
) -> OcrCapabilitiesResponse:
    """Public OCR capability probe for local debugging and frontend readiness checks."""
    capabilities = ocr_service.capabilities(multipart_available=_HAS_MULTIPART)
    return OcrCapabilitiesResponse(
        available=capabilities.available,
        selected_provider=capabilities.selected_provider,
        providers_checked=capabilities.providers_checked,
        reason_codes=capabilities.reason_codes,
    )


if _HAS_MULTIPART:

    @router.post(
        "/extract",
        response_model=OcrExtractResponse,
        status_code=status.HTTP_200_OK,
    )
    async def extract_text_from_image(
        auth_service: Annotated[AuthService, Depends(get_auth_service)],
        ocr_service: Annotated[OcrService, Depends(get_ocr_service)],
        file: UploadFile = File(...),
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    ) -> OcrExtractResponse:
        """Extract text from uploaded conversation screenshot using OCR."""
        try:
            _: AuthenticatedUser = auth_service.get_user_from_access_token(authorization)
        except AuthError as exc:
            logger.warning("OCR extract auth failed: detail=%s", exc.detail)
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        if file is None:
            raise HTTPException(status_code=400, detail="missing_image_file")
        content_type = (file.content_type or "").lower()
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=415, detail="unsupported_image_mime_type")

        payload = await file.read()
        if not payload:
            raise HTTPException(status_code=400, detail="empty_file")
        if len(payload) > settings.ocr_max_file_bytes:
            raise HTTPException(status_code=413, detail="file_too_large")

        try:
            result = ocr_service.extract_text(payload)
        except OcrError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except Exception as exc:
            logger.exception("Unexpected OCR endpoint failure: %s", exc)
            raise HTTPException(status_code=500, detail="ocr_internal_error") from exc

        response_warnings = list(result.warnings)
        conversation_turns: list[OcrConversationTurn] | None = None
        if result.conversation_turns:
            conversation_turns = []
            for index, turn in enumerate(result.conversation_turns):
                try:
                    if isinstance(turn, dict):
                        parsed_turn = OcrConversationTurn.model_validate(turn)
                    else:
                        parsed_turn = OcrConversationTurn(
                            speaker=str(getattr(turn, "speaker")),
                            text=str(getattr(turn, "text")),
                            time=(
                                str(getattr(turn, "time"))
                                if getattr(turn, "time", None) is not None
                                else None
                            ),
                        )
                    conversation_turns.append(parsed_turn)
                except Exception as exc:
                    logger.warning(
                        "Skipping invalid OCR conversation turn index=%s error=%s value=%r",
                        index,
                        exc,
                        turn,
                    )
                    if "ocr_turn_invalid_skipped" not in response_warnings:
                        response_warnings.append("ocr_turn_invalid_skipped")

        try:
            return OcrExtractResponse(
                extracted_text=result.extracted_text,
                provider=result.provider,
                confidence=result.confidence,
                warnings=response_warnings,
                conversation_turns=conversation_turns,
                raw_text=result.raw_text,
                metadata=result.metadata,
            )
        except ValidationError as exc:
            logger.exception("OCR response validation failed: %s", exc)
            raise HTTPException(status_code=500, detail="ocr_response_validation_failed") from exc

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
