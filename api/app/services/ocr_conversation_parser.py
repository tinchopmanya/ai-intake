import json
import logging
import re
from typing import Literal

from pydantic import BaseModel
from pydantic import Field
from pydantic import ValidationError

from app.schemas.ocr import OcrConversationBlock
from providers.base import AIProvider
from providers.base import AIProviderError

logger = logging.getLogger(__name__)

_PARSER_PROMPT = """You are a parser that receives OCR text extracted from a WhatsApp conversation.

Your task is ONLY to transform the OCR text into a structured list of message blocks.

Rules:
- Do not rewrite text.
- Do not summarize.
- Do not correct meaning.
- Preserve message content as much as possible.
- Split the text into likely message blocks.
- Assign each block a speaker:
  - ex_partner
  - user
- If uncertain, choose the most likely speaker.
- Add a confidence score from 0 to 1.
- Return JSON only.
- No explanations.

Output format:
{
  "blocks": [
    {
      "speaker": "ex_partner",
      "content": "text",
      "confidence": 0.78
    }
  ]
}

OCR text:
{text}
"""


class OcrParseResult(BaseModel):
    blocks: list[OcrConversationBlock] = Field(default_factory=list)
    method: Literal["gemini", "heuristic"]
    warnings: list[str] = Field(default_factory=list)


class _GeminiBlock(BaseModel):
    speaker: Literal["ex_partner", "user"]
    content: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class _GeminiResponse(BaseModel):
    blocks: list[_GeminiBlock] = Field(default_factory=list)


class OcrConversationParser:
    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    def parse(self, *, text: str, source: Literal["ocr", "text"]) -> OcrParseResult:
        normalized = text.strip()
        if not normalized:
            return OcrParseResult(blocks=[], method="heuristic", warnings=["conversation_interpretation_empty"])

        fallback_blocks = _heuristic_segment(normalized)
        should_use_gemini = source == "ocr" or len(fallback_blocks) < 2

        if should_use_gemini:
            try:
                prompt = _PARSER_PROMPT.format(text=normalized)
                raw_response = self._provider.generate_answer(prompt)
                gemini_blocks = _parse_gemini_blocks(raw_response)
                if gemini_blocks:
                    logger.info("parser_gemini_success blocks=%s", len(gemini_blocks))
                    return OcrParseResult(blocks=gemini_blocks, method="gemini", warnings=[])
                logger.warning("parser_gemini_failed reason=empty_blocks")
            except (AIProviderError, ValidationError, ValueError, json.JSONDecodeError) as exc:
                logger.warning("parser_gemini_failed error=%s", exc)
            except Exception as exc:
                logger.warning("parser_gemini_failed error=%s", exc)

        logger.info("parser_fallback_used blocks=%s", len(fallback_blocks))
        return OcrParseResult(
            blocks=fallback_blocks,
            method="heuristic",
            warnings=[] if fallback_blocks else ["conversation_interpretation_empty"],
        )


def _parse_gemini_blocks(raw_response: str) -> list[OcrConversationBlock]:
    payload = _extract_json_object(raw_response)
    if payload is None:
        raise ValueError("gemini_parser_invalid_json")
    parsed = _GeminiResponse.model_validate(payload)
    blocks: list[OcrConversationBlock] = []
    for index, block in enumerate(parsed.blocks):
        content = block.content.strip()
        if not content:
            continue
        blocks.append(
            OcrConversationBlock(
                id=str(index + 1),
                speaker=block.speaker,
                content=content,
                confidence=round(float(block.confidence), 4),
            )
        )
    return blocks


def _heuristic_segment(text: str) -> list[OcrConversationBlock]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return []

    chunks: list[tuple[str, str, float]] = []
    current_speaker: Literal["ex_partner", "user"] = "ex_partner"
    current_confidence = 0.25
    current_lines: list[str] = []

    for raw_line in lines:
        line = _strip_trailing_time(raw_line)
        if not line:
            continue
        speaker, content, confidence = _parse_labeled_line(line)
        next_speaker = speaker or current_speaker
        next_confidence = confidence if speaker is not None else current_confidence
        next_content = content.strip()
        if not next_content:
            continue

        if current_lines and next_speaker != current_speaker:
            chunks.append((current_speaker, " ".join(current_lines).strip(), current_confidence))
            current_lines = []

        current_speaker = next_speaker
        current_confidence = next_confidence
        current_lines.append(next_content)

    if current_lines:
        chunks.append((current_speaker, " ".join(current_lines).strip(), current_confidence))

    blocks: list[OcrConversationBlock] = []
    for index, (speaker, content, confidence) in enumerate(chunks):
        if not content:
            continue
        blocks.append(
            OcrConversationBlock(
                id=str(index + 1),
                speaker=speaker,
                content=content,
                confidence=round(confidence, 4),
            )
        )
    return blocks


def _parse_labeled_line(
    line: str,
) -> tuple[Literal["ex_partner", "user"] | None, str, float]:
    pattern = re.compile(
        r"^(yo|me|mi|tu|vos|ex|expareja|ex pareja|ella|el)\s*[:\-]\s*(.+)$",
        re.IGNORECASE,
    )
    match = pattern.match(line)
    if not match:
        return None, line, 0.25

    marker = match.group(1).strip().lower()
    text = match.group(2).strip()
    if marker in {"yo", "me", "mi", "tu", "vos"}:
        return "user", text, 0.55
    return "ex_partner", text, 0.55


def _strip_trailing_time(value: str) -> str:
    return re.sub(r"\s+\d{1,2}:\d{2}(?:\s*[ap]\.?\s*m\.?)?$", "", value).strip()


def _extract_json_object(raw_text: str) -> dict[str, object] | None:
    text = raw_text.strip()
    if not text:
        return None

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    fenced_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fenced_match:
        try:
            parsed = json.loads(fenced_match.group(1))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    bracket_match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not bracket_match:
        return None
    parsed = json.loads(bracket_match.group(0))
    return parsed if isinstance(parsed, dict) else None
