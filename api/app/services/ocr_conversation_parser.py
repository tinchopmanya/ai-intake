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

_WHATSAPP_LINE_PATTERN = re.compile(
    r"^\[(\d{1,2}:\d{2}),\s*(\d{1,2}/\d{1,2}/\d{4})\]\s*([^:]+):\s*(.*)$"
)


class OcrParseResult(BaseModel):
    blocks: list[OcrConversationBlock] = Field(default_factory=list)
    method: Literal["gemini", "heuristic"]
    warnings: list[str] = Field(default_factory=list)


class _GeminiBlock(BaseModel):
    speaker: Literal["ex_partner", "user", "unknown"]
    content: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class _GeminiResponse(BaseModel):
    blocks: list[_GeminiBlock]


class OcrConversationParser:
    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    def parse(
        self,
        *,
        text: str,
        source: Literal["ocr", "text"],
        user_name: str | None = None,
        ex_partner_name: str | None = None,
    ) -> OcrParseResult:
        normalized = text.strip()
        if not normalized:
            return OcrParseResult(blocks=[], method="heuristic", warnings=["conversation_interpretation_empty"])

        is_whatsapp_structured = source == "text" and _looks_like_whatsapp_structured(normalized)

        if is_whatsapp_structured:
            logger.info("parser_whatsapp_detected")
            whatsapp_blocks = _parse_whatsapp_structured(
                normalized,
                user_name=user_name,
                ex_partner_name=ex_partner_name,
            )
            if whatsapp_blocks:
                logger.info("parser_whatsapp_blocks_created blocks=%s", len(whatsapp_blocks))
                unknown_count = sum(1 for block in whatsapp_blocks if block.speaker == "unknown")
                if unknown_count > 0:
                    logger.info("parser_whatsapp_unknown_speakers count=%s", unknown_count)
                return OcrParseResult(blocks=whatsapp_blocks, method="heuristic", warnings=[])

        fallback_blocks = _heuristic_segment(normalized)
        should_use_gemini = source == "ocr" or not is_whatsapp_structured

        if should_use_gemini:
            logger.info("parser_gemini_attempted")
            try:
                prompt = _PARSER_PROMPT.format(text=normalized)
                raw_response = self._provider.generate_answer(prompt)
                gemini_blocks = _parse_gemini_blocks(raw_response)
                if gemini_blocks:
                    logger.info("parser_gemini_success blocks=%s", len(gemini_blocks))
                    return OcrParseResult(blocks=gemini_blocks, method="gemini", warnings=[])
                logger.warning("parser_gemini_failed reason=empty_blocks")
            except (ValueError, json.JSONDecodeError, ValidationError) as exc:
                logger.warning("parser_gemini_invalid_json error=%s", exc)
            except AIProviderError as exc:
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
    current_speaker: Literal["ex_partner", "user", "unknown"] = "ex_partner"
    current_confidence = 0.2
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
) -> tuple[Literal["ex_partner", "user", "unknown"] | None, str, float]:
    pattern = re.compile(
        r"^(yo|me|mi|tu|vos|ex|expareja|ex pareja|ella|el)\s*[:\-]\s*(.+)$",
        re.IGNORECASE,
    )
    match = pattern.match(line)
    if not match:
        return None, line, 0.2

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

    text = text.replace("```json", "").replace("```", "").strip()
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace >= first_brace:
        text = text[first_brace : last_brace + 1]

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[index:])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


def _looks_like_whatsapp_structured(text: str) -> bool:
    matches = 0
    for line in text.splitlines():
        if _WHATSAPP_LINE_PATTERN.match(line.strip()):
            matches += 1
            if matches >= 2:
                return True
    return False


def _normalize_person_name(value: str | None) -> str:
    if not value:
        return ""
    text = value.strip().lower()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _parse_whatsapp_structured(
    text: str,
    *,
    user_name: str | None,
    ex_partner_name: str | None,
) -> list[OcrConversationBlock]:
    user_normalized = _normalize_person_name(user_name)
    ex_normalized = _normalize_person_name(ex_partner_name)
    records: list[dict[str, str]] = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue
        match = _WHATSAPP_LINE_PATTERN.match(line)
        if match:
            records.append(
                {
                    "time": match.group(1).strip(),
                    "date": match.group(2).strip(),
                    "sender_name": match.group(3).strip(),
                    "content": match.group(4).strip(),
                }
            )
            continue
        if records:
            records[-1]["content"] = f"{records[-1]['content']}\n{line.strip()}".strip()

    blocks: list[OcrConversationBlock] = []
    for index, record in enumerate(records):
        sender = _normalize_person_name(record.get("sender_name"))
        content = str(record.get("content") or "").strip()
        if not content:
            continue
        speaker: Literal["user", "ex_partner", "unknown"] = "unknown"
        confidence = 0.4
        if sender and sender == user_normalized:
            speaker = "user"
            confidence = 1.0
        elif sender and sender == ex_normalized:
            speaker = "ex_partner"
            confidence = 1.0
        blocks.append(
            OcrConversationBlock(
                id=str(index + 1),
                speaker=speaker,
                content=content,
                confidence=confidence,
            )
        )
    return blocks
