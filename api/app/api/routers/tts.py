import logging
from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from fastapi.responses import Response
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user
from app.schemas.tts import TtsStreamRequest
from app.services.auth_service import AuthenticatedUser
from app.services.tts_service import DEFAULT_TTS_VOICE
from app.services.tts_service import normalize_tts_text
from app.services.tts_service import TtsProviderUnavailableError
from app.services.tts_service import resolve_tts_voice
from app.services.tts_service import stream_tts_audio

router = APIRouter(prefix="/v1/tts", tags=["tts"])
logger = logging.getLogger(__name__)


async def _collect_tts_audio_bytes(*, text: str, voice: str) -> bytes:
    audio_stream = stream_tts_audio(text=text, voice=voice)
    chunks: list[bytes] = []
    async for chunk in audio_stream:
        chunks.append(chunk)
    return b"".join(chunks)


@router.post(
    "/stream",
    status_code=status.HTTP_200_OK,
)
async def stream_tts(
    payload: TtsStreamRequest,
    _: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> StreamingResponse:
    normalized_text = normalize_tts_text(payload.text)
    if not normalized_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_tts_text")

    resolved_voice = resolve_tts_voice(payload.voice)

    try:
        audio_stream = stream_tts_audio(text=payload.text, voice=resolved_voice)
        first_chunk = await anext(audio_stream)

        async def response_stream():
            yield first_chunk
            async for chunk in audio_stream:
                yield chunk

        return StreamingResponse(
            response_stream(),
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "no-store",
                "X-TTS-Voice": resolved_voice or DEFAULT_TTS_VOICE,
            },
        )
    except (StopAsyncIteration, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_tts_text") from exc
    except TtsProviderUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.detail,
        ) from exc


@router.post(
    "/audio",
    status_code=status.HTTP_200_OK,
)
async def render_tts_audio(
    payload: TtsStreamRequest,
    _: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> Response:
    normalized_text = normalize_tts_text(payload.text)
    if not normalized_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_tts_text")

    resolved_voice = resolve_tts_voice(payload.voice)

    try:
        audio_bytes = await _collect_tts_audio_bytes(text=payload.text, voice=resolved_voice)
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "no-store",
                "X-TTS-Voice": resolved_voice or DEFAULT_TTS_VOICE,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_tts_text") from exc
    except TtsProviderUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.detail,
        ) from exc
