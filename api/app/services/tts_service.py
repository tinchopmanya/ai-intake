from __future__ import annotations

from collections.abc import AsyncIterator
import logging
import re

try:
    import edge_tts

    _HAS_EDGE_TTS = True
except Exception:  # pragma: no cover - handled by endpoint fallback
    edge_tts = None  # type: ignore[assignment]
    _HAS_EDGE_TTS = False

logger = logging.getLogger(__name__)

DEFAULT_TTS_VOICE = "es-AR-ElenaNeural"
SUPPORTED_TTS_VOICES: dict[str, str] = {
    "es-AR-ElenaNeural": "female",
    "es-MX-DaliaNeural": "female",
    "es-ES-AlvaroNeural": "male",
    "es-MX-JorgeNeural": "male",
}
TTS_RATE = "-10%"
TTS_PITCH = "+0Hz"
_PAUSE_BREAK_PATTERN = re.compile(r"(?<![.!?])([,;:])(?=\S)")
_WHITESPACE_PATTERN = re.compile(r"\s+")
_LONG_SENTENCE_BREAK_PATTERN = re.compile(r"\s+(pero|aunque|porque|entonces|ademas|igual|sin embargo)\s+", re.IGNORECASE)


class TtsVoiceNotSupportedError(ValueError):
    pass


class TtsProviderUnavailableError(RuntimeError):
    pass


def resolve_tts_voice(voice: str | None) -> str:
    normalized_voice = (voice or DEFAULT_TTS_VOICE).strip() or DEFAULT_TTS_VOICE
    if normalized_voice not in SUPPORTED_TTS_VOICES:
        raise TtsVoiceNotSupportedError(normalized_voice)
    return normalized_voice


def prepare_tts_text(text: str) -> str:
    normalized = _WHITESPACE_PATTERN.sub(" ", text.replace("\r", " ").replace("\n", ". ")).strip()
    if not normalized:
        return ""
    normalized = _PAUSE_BREAK_PATTERN.sub(r"\1 ", normalized)
    normalized = _LONG_SENTENCE_BREAK_PATTERN.sub(". ", normalized)
    normalized = re.sub(r"([.!?])(?=[A-Za-z])", r"\1 ", normalized)
    normalized = re.sub(r"\s{2,}", " ", normalized).strip()

    segments: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+", normalized):
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= 220:
            segments.append(sentence)
            continue
        chunks = [chunk.strip(" ,") for chunk in re.split(r",\s+", sentence) if chunk.strip(" ,")]
        if len(chunks) <= 1:
            segments.append(sentence)
            continue
        segments.extend(f"{chunk}." if chunk[-1] not in ".!?" else chunk for chunk in chunks)

    prepared = " ".join(segment.strip() for segment in segments if segment.strip()).strip()
    if prepared and prepared[-1] not in ".!?":
        prepared = f"{prepared}."
    return prepared


async def stream_tts_audio(*, text: str, voice: str | None = None) -> AsyncIterator[bytes]:
    if not _HAS_EDGE_TTS:
        raise TtsProviderUnavailableError("edge_tts_not_installed")

    prepared_text = prepare_tts_text(text)
    if not prepared_text:
        raise ValueError("empty_tts_text")

    resolved_voice = resolve_tts_voice(voice)

    try:
        communicate = edge_tts.Communicate(
            prepared_text,
            voice=resolved_voice,
            rate=TTS_RATE,
            pitch=TTS_PITCH,
        )
        async for chunk in communicate.stream():
            if chunk.get("type") != "audio":
                continue
            data = chunk.get("data")
            if isinstance(data, bytes) and data:
                yield data
    except Exception as exc:  # pragma: no cover - exercised through router tests with mocking
        logger.exception("tts_stream_failed voice=%s text_length=%s", resolved_voice, len(prepared_text))
        raise TtsProviderUnavailableError("tts_stream_failed") from exc
