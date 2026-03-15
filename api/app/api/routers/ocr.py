from typing import Annotated
import json
import logging
import re

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import Header
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status
from pydantic import ValidationError

from app.api.deps import get_auth_service
from app.api.deps import get_ai_provider
from app.api.deps import get_current_user
from app.api.deps import get_ocr_service
from app.schemas.ocr import OcrCapabilitiesResponse
from app.schemas.ocr import OcrConversationTurn
from app.schemas.ocr import OcrExtractResponse
from app.schemas.ocr import OcrInterpretRequest
from app.schemas.ocr import OcrInterpretResponse
from app.services.auth_service import AuthError
from app.services.auth_service import AuthenticatedUser
from app.services.auth_service import AuthService
from app.services.ocr_service import OcrError
from app.services.ocr_service import OcrService
from config import settings
from providers.base import AIProvider
from providers.base import AIProviderError

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


@router.post(
    "/interpret",
    response_model=OcrInterpretResponse,
    status_code=status.HTTP_200_OK,
)
async def interpret_text_as_conversation(
    payload: OcrInterpretRequest,
    _: Annotated[AuthenticatedUser, Depends(get_current_user)],
    provider: Annotated[AIProvider, Depends(get_ai_provider)],
) -> OcrInterpretResponse:
    """Interpret plain OCR/text content into message turns with optional Gemini assist."""
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty_interpretation_text")

    heuristic_turns = _heuristic_interpretation(text)
    should_use_gemini = payload.source == "ocr" or len(heuristic_turns) < 2

    if should_use_gemini:
        try:
            parsed = _interpret_with_gemini(provider=provider, text=text)
            if parsed:
                return OcrInterpretResponse(
                    conversation_turns=parsed,
                    method="gemini",
                    warnings=[],
                )
        except AIProviderError as exc:
            logger.warning("OCR interpretation Gemini fallback: %s", exc)
        except Exception as exc:
            logger.warning("OCR interpretation unexpected Gemini error: %s", exc)

    return OcrInterpretResponse(
        conversation_turns=heuristic_turns,
        method="heuristic",
        warnings=[] if heuristic_turns else ["conversation_interpretation_empty"],
    )


def _interpret_with_gemini(*, provider: AIProvider, text: str) -> list[OcrConversationTurn]:
    prompt = (
        "Analiza este texto extraido de una conversacion (WhatsApp u otro chat). "
        "No inventes contenido. Solo separa en bloques y asigna speaker.\n\n"
        "Reglas:\n"
        "- speaker debe ser exactamente 'me' o 'them'.\n"
        "- Conserva el texto original con minima limpieza.\n"
        "- Si dudas, usa 'them'.\n"
        "- Devuelve SOLO JSON valido.\n\n"
        "Formato de salida:\n"
        '{"conversation_turns":[{"speaker":"them","text":"..."}]}\n\n'
        f"Texto:\n{text}"
    )
    raw_response = provider.generate_answer(prompt)
    parsed_json = _extract_json_object(raw_response)
    if not parsed_json:
        return []

    raw_turns = parsed_json.get("conversation_turns")
    if not isinstance(raw_turns, list):
        return []

    turns: list[OcrConversationTurn] = []
    for item in raw_turns:
        if not isinstance(item, dict):
            continue
        speaker = str(item.get("speaker", "them")).strip().lower()
        text_value = str(item.get("text", "")).strip()
        if speaker not in {"me", "them"} or not text_value:
            continue
        turns.append(OcrConversationTurn(speaker=speaker, text=text_value))
    return _merge_consecutive_turns(turns)


def _heuristic_interpretation(text: str) -> list[OcrConversationTurn]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return []

    turns: list[OcrConversationTurn] = []
    current_speaker = "them"
    current_lines: list[str] = []

    for raw_line in lines:
        normalized_line = _strip_trailing_time(raw_line)
        if not normalized_line:
            continue
        parsed_speaker, parsed_text = _extract_labeled_speaker_line(normalized_line)
        speaker_for_line = parsed_speaker or current_speaker
        text_for_line = parsed_text or normalized_line

        if current_lines and speaker_for_line != current_speaker:
            joined = " ".join(current_lines).strip()
            if joined:
                turns.append(OcrConversationTurn(speaker=current_speaker, text=joined))
            current_lines = [text_for_line]
            current_speaker = speaker_for_line
            continue

        if not current_lines:
            current_speaker = speaker_for_line
        current_lines.append(text_for_line)

    if current_lines:
        joined = " ".join(current_lines).strip()
        if joined:
            turns.append(OcrConversationTurn(speaker=current_speaker, text=joined))

    return _merge_consecutive_turns(turns)


def _extract_labeled_speaker_line(value: str) -> tuple[str | None, str]:
    marker_pattern = re.compile(r"^(yo|me|mi|ex|expareja|ex pareja|ella|el|tu|vos)\s*[:\-]\s*(.+)$", re.IGNORECASE)
    match = marker_pattern.match(value.strip())
    if not match:
        return None, value

    marker = match.group(1).strip().lower()
    text = match.group(2).strip()
    if marker in {"yo", "me", "mi"}:
        return "me", text
    if marker in {"tu", "vos"}:
        return "me", text
    return "them", text


def _strip_trailing_time(value: str) -> str:
    return re.sub(r"\s+\d{1,2}:\d{2}(?:\s*[ap]\.?\s*m\.?)?$", "", value).strip()


def _merge_consecutive_turns(turns: list[OcrConversationTurn]) -> list[OcrConversationTurn]:
    if not turns:
        return []
    merged: list[OcrConversationTurn] = []
    for turn in turns:
        if merged and merged[-1].speaker == turn.speaker:
            merged[-1] = OcrConversationTurn(
                speaker=turn.speaker,
                text=f"{merged[-1].text} {turn.text}".strip(),
            )
            continue
        merged.append(turn)
    return merged


def _extract_json_object(raw_text: str) -> dict[str, object] | None:
    raw_text = raw_text.strip()
    if not raw_text:
        return None
    try:
        parsed = json.loads(raw_text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", raw_text, flags=re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
