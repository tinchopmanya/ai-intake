from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any
from typing import Iterable
from uuid import UUID

from app.prompts.safe_memory_prompt import SAFE_MEMORY_SYSTEM_PROMPT
from app.prompts.safe_memory_prompt import build_safe_memory_user_payload
from app.schemas.memory_items import ExPartnerHistoricalReportResponse
from app.schemas.memory_items import MemoryAggregateBucket
from app.services.auth_service import AuthenticatedUser
from app.services.conversation_titles import get_safe_conversation_title
from providers.base import AIProvider
from providers.base import AIProviderError

_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE_RE = re.compile(r"(?:(?:\+|00)\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d[\d\s-]{6,}\d")
_DOCUMENT_RE = re.compile(
    r"\b(?:dni|ci|cedula|cedula de identidad|documento|pasaporte)\s*[:#-]?\s*[A-Z0-9.-]{4,20}\b",
    re.IGNORECASE,
)
_ADDRESS_RE = re.compile(
    r"\b(?:calle|avenida|av\.?|ruta|camino|pasaje)\s+[A-Z0-9ÁÉÍÓÚÑáéíóúñ .'-]{3,50}\d{1,5}\b",
    re.IGNORECASE,
)
_INSTITUTION_RE = re.compile(
    r"\b(?P<kind>colegio|escuela|liceo|jardin|hospital|clinica|sanatorio)\s+"
    r"[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'-]*(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'-]*)*",
    re.IGNORECASE,
)
_HEALTH_DETAIL_RE = re.compile(
    r"\b(diagnostico|diagnostico de|diagnostico por|medicacion|medicacion de|tratamiento|terapia|"
    r"psicologo|psicologa|psiquiatra|depresion|ansiedad|autismo|trastorno)\b[^.,;\n]{0,80}",
    re.IGNORECASE,
)
_VIOLENCE_RE = re.compile(r"\b(golpe|violencia|agresion|agresi[oó]n|amenaza|maltrato|abuso)\b", re.IGNORECASE)
_INSULT_RE = re.compile(r"\b(idiota|tarado|forro|mierda|pelotudo|pelotuda|hijo de puta)\b", re.IGNORECASE)
_TIMESTAMP_RE = re.compile(r"\b\d{1,2}:\d{2}\b")


@dataclass(frozen=True)
class SafeMemoryDraft:
    memory_type: str
    source_kind: str
    safe_title: str
    safe_summary: str
    tone: str | None
    risk_level: str | None
    recommended_next_step: str | None
    is_sensitive: bool
    metadata: dict[str, Any]


@dataclass(frozen=True)
class SanitizedPayload:
    sanitized_text: str
    metadata: dict[str, Any]
    is_sensitive: bool


class SafeMemoryService:
    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    def build_checkin_memory(
        self,
        *,
        mood_level: int,
        confidence_level: int,
        recent_contact: bool,
        vinculo_expareja: int | None = None,
        interaccion_hijos: int | None = None,
    ) -> SafeMemoryDraft:
        mood_label = _CHECKIN_MOOD_LABELS.get(mood_level, "sin definir")
        confidence_label = _CHECKIN_CONFIDENCE_LABELS.get(confidence_level, "sin definir")
        relationship_label = _CHECKIN_RELATIONSHIP_LABELS.get(vinculo_expareja)
        children_interaction_label = _CHECKIN_CHILDREN_INTERACTION_LABELS.get(interaccion_hijos)
        tone = _resolve_checkin_tone(mood_level=mood_level, confidence_level=confidence_level)
        risk_level = _resolve_checkin_risk(mood_level=mood_level, confidence_level=confidence_level, recent_contact=recent_contact)
        recommended_next_step = _resolve_checkin_recommendation(
            mood_level=mood_level,
            confidence_level=confidence_level,
            recent_contact=recent_contact,
        )
        summary_parts = [
            f"Registro emocional del dia con animo {mood_label}, confianza {confidence_label}",
            f"y contacto reciente {'si' if recent_contact else 'no'}",
        ]
        if relationship_label:
            summary_parts.append(f". Vinculo con la expareja {relationship_label}")
        if children_interaction_label:
            summary_parts.append(f" e interaccion vinculada a hijos {children_interaction_label}")
        safe_summary = "".join(summary_parts).strip()
        if not safe_summary.endswith("."):
            safe_summary = f"{safe_summary}."
        return SafeMemoryDraft(
            memory_type="mood_checkin",
            source_kind="checkin",
            safe_title="Check-in emocional",
            safe_summary=safe_summary,
            tone=tone,
            risk_level=risk_level,
            recommended_next_step=recommended_next_step,
            is_sensitive=mood_level <= 1 and recent_contact,
            metadata={
                "mood_level": mood_level,
                "confidence_level": confidence_level,
                "recent_contact": recent_contact,
                "vinculo_expareja": vinculo_expareja,
                "interaccion_hijos": interaccion_hijos,
            },
        )

    def build_exchange_memory(
        self,
        *,
        source_text: str,
        analysis_summary: str | None,
        current_user: AuthenticatedUser,
        source_kind: str,
        case_contact_name: str | None = None,
        child_names: list[str] | None = None,
    ) -> SafeMemoryDraft:
        sanitized = sanitize_for_safe_memory(
            source_text=source_text,
            current_user=current_user,
            case_contact_name=case_contact_name,
            child_names=child_names or [],
        )
        sanitized_analysis = sanitize_for_safe_memory(
            source_text=analysis_summary or "",
            current_user=current_user,
            case_contact_name=case_contact_name,
            child_names=child_names or [],
        )
        model_result = self._summarize_with_model(
            sanitized_text=sanitized.sanitized_text,
            sanitized_analysis_summary=sanitized_analysis.sanitized_text,
            current_user=current_user,
            source_kind=source_kind,
            is_sensitive=sanitized.is_sensitive or sanitized_analysis.is_sensitive,
        )
        if model_result is None:
            return self._fallback_exchange_memory(
                source_text=sanitized.sanitized_text,
                analysis_summary=sanitized_analysis.sanitized_text,
                source_kind=source_kind,
                is_sensitive=sanitized.is_sensitive or sanitized_analysis.is_sensitive,
                metadata={
                    **sanitized.metadata,
                    **({"analysis_summary_redacted": True} if sanitized_analysis.sanitized_text else {}),
                },
            )

        return SafeMemoryDraft(
            memory_type="coparenting_exchange_summary",
            source_kind=source_kind,
            safe_title=model_result["safe_title"],
            safe_summary=model_result["safe_summary"],
            tone=model_result["tone"],
            risk_level=model_result["risk_level"],
            recommended_next_step=model_result["recommended_next_step"],
            is_sensitive=bool(model_result["is_sensitive"]),
            metadata={
                **sanitized.metadata,
                "generated_with_model": True,
            },
        )

    def build_advisor_session_memory(
        self,
        *,
        original_input_text: str,
        suggested_responses: Iterable[str],
        analysis_summary: str | None,
        current_user: AuthenticatedUser,
    ) -> SafeMemoryDraft:
        sanitized = sanitize_for_safe_memory(source_text=original_input_text, current_user=current_user)
        response_count = len([text for text in suggested_responses if text.strip()])
        summary = "Sesion de consejero con acompanamiento para ordenar la respuesta y bajar escalada."
        if analysis_summary and analysis_summary.strip():
            summary = "Sesion de consejero enfocada en revisar una decision y proponer una respuesta mas segura."
        return SafeMemoryDraft(
            memory_type="advisor_session_summary",
            source_kind="advisor",
            safe_title="Sesion con consejero",
            safe_summary=summary,
            tone="acompanado",
            risk_level="moderate" if sanitized.is_sensitive else "low",
            recommended_next_step="Revisar la recomendacion elegida antes de enviar cualquier mensaje.",
            is_sensitive=sanitized.is_sensitive,
            metadata={
                **sanitized.metadata,
                "response_options_count": response_count,
            },
        )

    def build_ex_partner_report(
        self,
        *,
        items: list[dict[str, Any]],
    ) -> ExPartnerHistoricalReportResponse:
        if not items:
            return ExPartnerHistoricalReportResponse(
                total_items=0,
                predominant_tone=None,
                predominant_risk_level=None,
                frequent_topics=[],
                recurring_recommendations=[],
                global_summary="Todavia no hay memoria historica suficiente para consolidar.",
            )

        topic_counter = Counter()
        recommendation_counter = Counter()
        tone_counter = Counter()
        risk_counter = Counter()

        for item in items:
            topic = _resolve_topic_from_memory_row(item)
            if topic:
                topic_counter[topic] += 1
            recommendation = str(item.get("recommended_next_step") or "").strip()
            if recommendation:
                recommendation_counter[recommendation] += 1
            tone = str(item.get("tone") or "").strip()
            if tone:
                tone_counter[tone] += 1
            risk = str(item.get("risk_level") or "").strip()
            if risk:
                risk_counter[risk] += 1

        frequent_topics = [
            MemoryAggregateBucket(label=label, count=count)
            for label, count in topic_counter.most_common(4)
        ]
        recurring_recommendations = [
            MemoryAggregateBucket(label=label, count=count)
            for label, count in recommendation_counter.most_common(4)
        ]
        predominant_tone = tone_counter.most_common(1)[0][0] if tone_counter else None
        predominant_risk_level = risk_counter.most_common(1)[0][0] if risk_counter else None
        leading_topic = frequent_topics[0].label if frequent_topics else "temas en revision"
        summary = (
            f"Se consolidaron {len(items)} intercambio(s) utiles. "
            f"Predomina el tema {leading_topic.lower()} y un tono "
            f"{(predominant_tone or 'en revision').lower()}."
        )
        return ExPartnerHistoricalReportResponse(
            total_items=len(items),
            predominant_tone=predominant_tone,
            predominant_risk_level=predominant_risk_level,
            frequent_topics=frequent_topics,
            recurring_recommendations=recurring_recommendations,
            global_summary=summary,
        )

    def _summarize_with_model(
        self,
        *,
        sanitized_text: str,
        sanitized_analysis_summary: str,
        current_user: AuthenticatedUser,
        source_kind: str,
        is_sensitive: bool,
    ) -> dict[str, Any] | None:
        prompt_variables = {
            "relationship_mode": current_user.relationship_mode,
            "children_count_category": current_user.children_count_category,
            "source_kind": source_kind,
            "is_sensitive_input": is_sensitive,
            "sanitized_source_text": sanitized_text[:5000],
            "sanitized_analysis_summary": sanitized_analysis_summary[:1500],
        }
        model_input = (
            "SYSTEM:\n"
            f"{SAFE_MEMORY_SYSTEM_PROMPT}\n\n"
            "USER:\n"
            f"{build_safe_memory_user_payload(prompt_variables)}"
        )
        try:
            raw_output = self._provider.generate_answer(model_input)
        except AIProviderError:
            return None
        except Exception:
            return None

        parsed = _extract_json_object(raw_output)
        if parsed is None:
            return None
        validated = _validate_model_payload(parsed)
        return validated

    def _fallback_exchange_memory(
        self,
        *,
        source_text: str,
        analysis_summary: str,
        source_kind: str,
        is_sensitive: bool,
        metadata: dict[str, Any],
    ) -> SafeMemoryDraft:
        combined = "\n".join([part for part in (analysis_summary.strip(), source_text.strip()) if part]).strip()
        safe_title = get_safe_conversation_title(
            source_text=source_text,
            analysis_summary=analysis_summary or None,
        )
        tone = _infer_tone_from_text(combined)
        risk_level = _infer_risk_from_text(combined, is_sensitive=is_sensitive)
        recommended_next_step = _infer_recommendation_from_title(safe_title=safe_title, risk_level=risk_level)
        return SafeMemoryDraft(
            memory_type="coparenting_exchange_summary",
            source_kind=source_kind,
            safe_title=safe_title,
            safe_summary=_build_safe_summary_from_title(safe_title=safe_title, risk_level=risk_level),
            tone=tone,
            risk_level=risk_level,
            recommended_next_step=recommended_next_step,
            is_sensitive=is_sensitive or risk_level == "sensitive",
            metadata={
                **metadata,
                "generated_with_model": False,
                "topic_label": _topic_from_title(safe_title),
            },
        )


def sanitize_for_safe_memory(
    *,
    source_text: str,
    current_user: AuthenticatedUser,
    case_contact_name: str | None = None,
    child_names: list[str] | None = None,
) -> SanitizedPayload:
    normalized = source_text.strip()
    if not normalized:
        return SanitizedPayload(sanitized_text="", metadata={"aliases_applied": []}, is_sensitive=False)

    aliases = _build_alias_map(
        current_user=current_user,
        case_contact_name=case_contact_name,
        child_names=child_names or [],
    )
    sanitized = normalized
    aliases_applied: list[str] = []
    for raw_value, alias in aliases:
        pattern = re.compile(rf"(?<!\w){re.escape(raw_value)}(?!\w)", re.IGNORECASE)
        if pattern.search(sanitized):
            sanitized = pattern.sub(alias, sanitized)
            aliases_applied.append(alias)

    sanitized = _EMAIL_RE.sub("@email", sanitized)
    sanitized = _PHONE_RE.sub("@telefono", sanitized)
    sanitized = _DOCUMENT_RE.sub("@documento", sanitized)
    sanitized = _ADDRESS_RE.sub("@direccion", sanitized)
    sanitized = _INSTITUTION_RE.sub(lambda match: f"{match.group('kind')} @institucion", sanitized)
    sanitized = _HEALTH_DETAIL_RE.sub("informacion de salud sensible", sanitized)
    sanitized = re.sub(r"\b\d{7,10}\b", "@identificador", sanitized)
    sanitized = _collapse_whitespace(sanitized)

    is_sensitive = bool(_HEALTH_DETAIL_RE.search(normalized) or _VIOLENCE_RE.search(normalized))
    if _INSULT_RE.search(normalized):
        is_sensitive = True
    metadata = {
        "aliases_applied": sorted(set(aliases_applied)),
        "redacted_timestamps": bool(_TIMESTAMP_RE.search(normalized)),
    }
    return SanitizedPayload(sanitized_text=sanitized[:6000], metadata=metadata, is_sensitive=is_sensitive)


def _build_alias_map(
    *,
    current_user: AuthenticatedUser,
    case_contact_name: str | None,
    child_names: list[str],
) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add_alias(raw_value: str | None, alias: str) -> None:
        normalized = " ".join((raw_value or "").strip().split())
        if not normalized:
            return
        lowered = normalized.casefold()
        if lowered in seen:
            return
        seen.add(lowered)
        pairs.append((normalized, alias))

    add_alias(current_user.ex_partner_name, "@expareja")
    add_alias(case_contact_name, "@expareja")
    for index, child_name in enumerate(child_names, start=1):
        add_alias(child_name, f"@hijo{index}")
    pairs.sort(key=lambda item: len(item[0]), reverse=True)
    return pairs


def _extract_json_object(raw_text: str) -> dict[str, Any] | None:
    text = raw_text.strip()
    if not text:
        return None
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass

    cleaned = text.replace("```json", "").replace("```", "").strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _validate_model_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    safe_title = _clean_model_text(payload.get("safe_title"), max_length=120)
    safe_summary = _clean_model_text(payload.get("safe_summary"), max_length=320)
    tone = _clean_model_text(payload.get("tone"), max_length=60)
    recommended_next_step = _clean_model_text(payload.get("recommended_next_step"), max_length=200)
    risk_level = str(payload.get("risk_level") or "").strip().lower()
    is_sensitive = bool(payload.get("is_sensitive", False))

    if not safe_title or not safe_summary or not tone or not recommended_next_step:
        return None
    if risk_level not in {"low", "moderate", "high", "sensitive"}:
        return None
    if _contains_disallowed_output(safe_title) or _contains_disallowed_output(safe_summary):
        return None
    if "@" in safe_title or "@" in safe_summary:
        return None

    return {
        "safe_title": safe_title,
        "safe_summary": safe_summary,
        "tone": tone,
        "risk_level": risk_level,
        "recommended_next_step": recommended_next_step,
        "is_sensitive": is_sensitive,
    }


def _clean_model_text(value: Any, *, max_length: int) -> str | None:
    text = " ".join(str(value or "").strip().split())
    if not text:
        return None
    return text[:max_length]


def _contains_disallowed_output(text: str) -> bool:
    lowered = text.lower()
    disallowed_patterns = (
        r"\b(insulto|violacion|violaci[oó]n|pelotud|idiota|mierda|abandono)\b",
        r"\"",
        r"'",
    )
    return any(re.search(pattern, lowered) for pattern in disallowed_patterns)


def _collapse_whitespace(text: str) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _infer_tone_from_text(text: str) -> str:
    lowered = text.lower()
    if re.search(r"\b(urgente|limite|presion|amenaz|conflict|tension)\b", lowered):
        return "tenso"
    if re.search(r"\b(horario|visita|coordin|agenda|retiro|entrega|gasto)\b", lowered):
        return "logistico"
    return "neutral"


def _infer_risk_from_text(text: str, *, is_sensitive: bool) -> str:
    lowered = text.lower()
    if is_sensitive or _VIOLENCE_RE.search(lowered):
        return "sensitive"
    if re.search(r"\b(amenaz|agres|limite|hostil|presion)\b", lowered):
        return "high"
    if re.search(r"\b(conflict|tension|urgente|discut)\b", lowered):
        return "moderate"
    return "low"


def _infer_recommendation_from_title(*, safe_title: str, risk_level: str) -> str:
    lowered = safe_title.lower()
    if risk_level in {"high", "sensitive"}:
        return "Revisar el intercambio con cautela y evitar responder en caliente."
    if "gasto" in lowered or "logistica" in lowered:
        return "Responder solo con datos concretos y dejar registro de lo acordado."
    if "coordinacion" in lowered or "visita" in lowered or "horario" in lowered:
        return "Mantener una respuesta breve y centrada en coordinacion."
    return "Mantener el intercambio en un tono funcional y sin exponer detalles personales."


def _build_safe_summary_from_title(*, safe_title: str, risk_level: str) -> str:
    if risk_level in {"high", "sensitive"}:
        return f"Intercambio resumido de forma abstracta sobre {safe_title.lower()} con necesidad de revisar el tono antes de responder."
    return f"Intercambio funcional resumido de forma segura sobre {safe_title.lower()}."


def _topic_from_title(safe_title: str) -> str:
    lowered = safe_title.lower()
    if "gasto" in lowered:
        return "Gastos"
    if "horario" in lowered or "visita" in lowered or "coordinacion" in lowered:
        return "Coordinacion"
    if "famil" in lowered:
        return "Tema familiar"
    if "logistica" in lowered or "documentacion" in lowered:
        return "Logistica"
    return "Revision general"


def _resolve_topic_from_memory_row(item: dict[str, Any]) -> str | None:
    metadata = item.get("memory_metadata")
    if isinstance(metadata, dict):
        topic_label = str(metadata.get("topic_label") or "").strip()
        if topic_label:
            return topic_label
    safe_title = str(item.get("safe_title") or "").strip()
    if not safe_title:
        return None
    return _topic_from_title(safe_title)


_CHECKIN_MOOD_LABELS = {
    0: "muy bajo",
    1: "bajo",
    2: "estable",
    3: "bastante bien",
    4: "fuerte",
}

_CHECKIN_CONFIDENCE_LABELS = {
    0: "muy frágil",
    1: "insegura",
    2: "estable",
    3: "firme",
    4: "muy firme",
}


_CHECKIN_RELATIONSHIP_LABELS = {
    1: "demasiado conflictivo",
    2: "tenso pero sin conflicto",
    3: "neutro",
    4: "mejorando",
    5: "en paz",
}

_CHECKIN_CHILDREN_INTERACTION_LABELS = {
    1: "muy dificil",
    2: "con tension",
    3: "normal",
    4: "tranquila",
    5: "muy bien",
}


def _resolve_checkin_tone(*, mood_level: int, confidence_level: int) -> str:
    if mood_level <= 1 or confidence_level <= 1:
        return "vulnerable"
    if mood_level >= 3 and confidence_level >= 3:
        return "estable"
    return "variable"


def _resolve_checkin_risk(*, mood_level: int, confidence_level: int, recent_contact: bool) -> str:
    if mood_level <= 1 and recent_contact:
        return "high"
    if mood_level <= 1 or confidence_level <= 1:
        return "moderate"
    return "low"


def _resolve_checkin_recommendation(*, mood_level: int, confidence_level: int, recent_contact: bool) -> str:
    if mood_level <= 1 and recent_contact:
        return "Bajar exposicion al contacto y priorizar apoyo antes de responder."
    if confidence_level <= 1:
        return "Tomar una pausa antes de cualquier decision importante."
    return "Mantener seguimiento emocional y revisar cambios si vuelve a haber contacto reciente."
