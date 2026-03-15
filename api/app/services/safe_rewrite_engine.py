from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.prompts.safe_rewrite_prompt import SAFE_REWRITE_SYSTEM_PROMPT
from app.prompts.safe_rewrite_prompt import build_safe_rewrite_prompt_variables
from app.prompts.safe_rewrite_prompt import build_safe_rewrite_user_payload
from app.schemas.rewrite import SafeRewriteOption
from app.schemas.rewrite import SafeRewriteRequest
from app.schemas.rewrite import SafeRewriteResponse
from providers.base import AIProvider
from providers.base import AIProviderError

_TIME_RE = re.compile(r"\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b")
_DATE_RE = re.compile(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b")
_AMOUNT_RE = re.compile(r"(?:\$\s?\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?)|(?:\b\d+(?:[.,]\d{1,2})?\s?(?:usd|eur|ars|uyu)\b)", re.IGNORECASE)
_NUMBER_RE = re.compile(r"\b\d+(?:[.,]\d+)?\b")


@dataclass(frozen=True)
class InvariantValidationResult:
    valid: bool
    missing_tokens: list[str]


class SafeRewriteEngine:
    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    def rewrite(self, request: SafeRewriteRequest) -> SafeRewriteResponse:
        model_output = self._call_model(request)
        parsed = _parse_model_output(model_output)
        if not parsed:
            return _fallback_response(request.original_message)

        validated: list[SafeRewriteOption] = []
        for item in parsed[: request.options_count]:
            token_validation = validate_factual_invariants(request.original_message, item.text)
            if not token_validation.valid:
                continue
            validated.append(item)

        if len(validated) < request.options_count:
            return _fallback_response(request.original_message)
        return SafeRewriteResponse(responses=validated[: request.options_count])

    def _call_model(self, request: SafeRewriteRequest) -> str:
        variables = build_safe_rewrite_prompt_variables(
            relationship_mode=request.relationship_mode,
            response_style=request.response_style,
            original_message=request.original_message,
        )
        user_payload = build_safe_rewrite_user_payload(variables)
        model_input = (
            "SYSTEM:\n"
            f"{SAFE_REWRITE_SYSTEM_PROMPT}\n\n"
            "USER:\n"
            f"{user_payload}"
        )
        try:
            return self._provider.generate_answer(model_input)
        except AIProviderError:
            return ""
        except Exception:
            return ""


def validate_factual_invariants(original_message: str, rewritten_message: str) -> InvariantValidationResult:
    original_tokens = _extract_protected_tokens(original_message)
    rewritten_tokens = _extract_protected_tokens(rewritten_message)
    missing = sorted(original_tokens - rewritten_tokens)
    return InvariantValidationResult(valid=(len(missing) == 0), missing_tokens=missing)


def _extract_protected_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    lowered = text.lower()
    for matcher in (_TIME_RE, _DATE_RE, _AMOUNT_RE, _NUMBER_RE):
        for match in matcher.findall(lowered):
            token = str(match).strip()
            if token:
                tokens.add(token)
    return tokens


def _parse_model_output(raw_text: str) -> list[SafeRewriteOption]:
    if not raw_text:
        return []
    payload = _extract_json_object(raw_text)
    if payload is None:
        return []
    items = payload.get("responses")
    if not isinstance(items, list):
        return []

    parsed: list[SafeRewriteOption] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        style = str(item.get("style", "")).strip().lower()
        text = str(item.get("text", "")).strip()
        if style not in {"neutral", "calm", "firm"} or not text:
            continue
        try:
            parsed.append(SafeRewriteOption(style=style, text=text))
        except Exception:
            continue

    style_order = ["neutral", "calm", "firm"]
    by_style = {item.style: item for item in parsed}
    return [by_style[style] for style in style_order if style in by_style]


def _extract_json_object(raw_text: str) -> dict[str, object] | None:
    text = raw_text.strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _fallback_response(original_message: str) -> SafeRewriteResponse:
    trimmed = re.sub(r"\s+", " ", original_message).strip()
    neutral = trimmed
    calm = f"Prefiero que lo conversemos con calma. {trimmed}".strip()
    firm = f"Necesito mantenernos en lo concreto: {trimmed}".strip()
    return SafeRewriteResponse(
        responses=[
            SafeRewriteOption(style="neutral", text=neutral),
            SafeRewriteOption(style="calm", text=calm),
            SafeRewriteOption(style="firm", text=firm),
        ]
    )
