from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Severity = Literal["low", "medium", "high"]
AlertLevel = Literal["info", "warning", "critical"]


@dataclass(frozen=True)
class RiskFlagResult:
    code: str
    severity: Severity
    confidence: float
    evidence: list[str]


@dataclass(frozen=True)
class UiAlertResult:
    level: AlertLevel
    message: str


@dataclass(frozen=True)
class EmotionalContextResult:
    tone: str
    intent_guess: str


@dataclass(frozen=True)
class LinterResult:
    summary: str
    risk_flags: list[RiskFlagResult]
    emotional_context: EmotionalContextResult
    ui_alerts: list[UiAlertResult]


def run_emotional_linter(message_text: str, *, quick_mode: bool = False) -> LinterResult:
    text = _normalize(message_text)
    matches: dict[str, list[str]] = {}

    _collect_matches(matches, "high_emotion", text, _HIGH_EMOTION_PATTERNS)
    _collect_matches(matches, "passive_aggressive", text, _PASSIVE_AGGRESSIVE_PATTERNS)
    _collect_matches(matches, "legal_sensitive", text, _LEGAL_SENSITIVE_PATTERNS)
    _collect_matches(matches, "custody_related", text, _CUSTODY_PATTERNS)
    _collect_matches(matches, "boundary_pressure", text, _BOUNDARY_PRESSURE_PATTERNS)
    _collect_matches(matches, "urgency_conflict", text, _URGENCY_PATTERNS)

    risk_flags = _build_risk_flags(matches, message_text)
    if quick_mode and len(risk_flags) > 3:
        risk_flags = risk_flags[:3]

    emotional_context = _build_emotional_context(risk_flags)
    summary = _build_summary(risk_flags, emotional_context, quick_mode=quick_mode)
    ui_alerts = _build_ui_alerts(risk_flags, quick_mode=quick_mode)

    return LinterResult(
        summary=summary,
        risk_flags=risk_flags,
        emotional_context=emotional_context,
        ui_alerts=ui_alerts,
    )


def extract_risk_codes(risk_flags: list[RiskFlagResult]) -> list[str]:
    return [flag.code for flag in risk_flags]


def _build_risk_flags(matches: dict[str, list[str]], raw_message: str) -> list[RiskFlagResult]:
    flags: list[RiskFlagResult] = []
    total_signals = sum(len(items) for items in matches.values())
    uppercase_ratio = _uppercase_ratio(raw_message)

    for code, evidence in matches.items():
        base_confidence = min(0.95, 0.5 + (0.1 * len(evidence)))
        if code == "high_emotion" and uppercase_ratio > 0.35:
            base_confidence = min(0.95, base_confidence + 0.15)

        severity = "low"
        if code in {"legal_sensitive", "custody_related", "boundary_pressure"} and len(evidence) >= 1:
            severity = "medium"
        if code == "high_emotion" and (len(evidence) >= 2 or uppercase_ratio > 0.35):
            severity = "high"
        if total_signals >= 4 and severity == "medium":
            severity = "high"

        flags.append(
            RiskFlagResult(
                code=code,
                severity=severity,
                confidence=round(base_confidence, 2),
                evidence=evidence[:4],
            )
        )

    flags.sort(key=_risk_sort_key)
    return flags


def _build_emotional_context(risk_flags: list[RiskFlagResult]) -> EmotionalContextResult:
    codes = {flag.code for flag in risk_flags}
    high = any(flag.severity == "high" for flag in risk_flags)

    if high or "high_emotion" in codes:
        tone = "tenso"
    elif "passive_aggressive" in codes:
        tone = "pasivo_agresivo"
    else:
        tone = "neutral"

    if "custody_related" in codes:
        intent = "coordinar logistica de coparentalidad con carga emocional"
    elif "legal_sensitive" in codes:
        intent = "gestionar conflicto sensible con riesgo legal percibido"
    else:
        intent = "responder con claridad y limites saludables"

    return EmotionalContextResult(tone=tone, intent_guess=intent)


def _build_summary(
    risk_flags: list[RiskFlagResult],
    emotional_context: EmotionalContextResult,
    *,
    quick_mode: bool,
) -> str:
    if not risk_flags:
        if quick_mode:
            return "Quick mode: sin riesgos relevantes detectados."
        return "No se detectaron riesgos relevantes; conviene mantener un tono claro y cooperativo."

    top_codes = ", ".join(flag.code for flag in risk_flags[:2])
    if quick_mode:
        return f"Quick mode: señales detectadas ({top_codes})."
    return (
        f"Se detectaron señales de conflicto ({top_codes}); tono {emotional_context.tone}. "
        "Conviene responder breve, neutral y orientado a logistica."
    )


def _build_ui_alerts(risk_flags: list[RiskFlagResult], *, quick_mode: bool) -> list[UiAlertResult]:
    if not risk_flags:
        return []

    alerts: list[UiAlertResult] = []
    codes = {flag.code for flag in risk_flags}
    high_detected = any(flag.severity == "high" for flag in risk_flags)

    if high_detected:
        alerts.append(
            UiAlertResult(
                level="warning",
                message="Hay alta carga emocional. Conviene responder breve y neutral.",
            )
        )
    if "custody_related" in codes:
        alerts.append(
            UiAlertResult(
                level="info",
                message="Tema de coparentalidad detectado: prioriza logistica clara y verificable.",
            )
        )
    if "legal_sensitive" in codes:
        alerts.append(
            UiAlertResult(
                level="warning",
                message="Se detecto sensibilidad legal: evita afirmaciones categoricas.",
            )
        )

    if quick_mode:
        return alerts[:1]
    return alerts[:3]


def _collect_matches(
    target: dict[str, list[str]],
    code: str,
    text: str,
    patterns: list[str],
) -> None:
    evidence: list[str] = []
    for pattern in patterns:
        if re.search(pattern, text, flags=re.IGNORECASE):
            evidence.append(pattern.replace("\\b", "").replace("\\", ""))
    if evidence:
        target[code] = evidence


def _risk_sort_key(flag: RiskFlagResult) -> tuple[int, float]:
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    return (severity_rank[flag.severity], -flag.confidence)


def _normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _uppercase_ratio(value: str) -> float:
    letters = [char for char in value if char.isalpha()]
    if not letters:
        return 0.0
    upper = [char for char in letters if char.isupper()]
    return len(upper) / len(letters)


_HIGH_EMOTION_PATTERNS = [
    r"!!!+",
    r"\bsiempre\b",
    r"\bnunca\b",
    r"\bme tenes hart[oa]\b",
    r"\binsoportable\b",
    r"\bidiot[ao]\b",
]

_PASSIVE_AGGRESSIVE_PATTERNS = [
    r"\bcomo siempre\b",
    r"\bobvio que no\b",
    r"\bhace lo que quieras\b",
    r"\bclaro, seguro\b",
]

_LEGAL_SENSITIVE_PATTERNS = [
    r"\babogad[oa]\b",
    r"\bdenuncia\b",
    r"\bjuicio\b",
    r"\bdemandar\b",
    r"\bcautelar\b",
]

_CUSTODY_PATTERNS = [
    r"\btenencia\b",
    r"\bvisitas?\b",
    r"\bcolegio\b",
    r"\bhijos?\b",
    r"\bretiro\b",
    r"\bentrega\b",
    r"\bregimen\b",
]

_BOUNDARY_PRESSURE_PATTERNS = [
    r"\bsi no\b.+\b(mala madre|mal padre)\b",
    r"\bsi no\b.+\bte arrepentis\b",
    r"\bculpa tuya\b",
]

_URGENCY_PATTERNS = [
    r"\bahora mismo\b",
    r"\bresponde ya\b",
    r"\bya mismo\b",
    r"\burgente\b",
]

