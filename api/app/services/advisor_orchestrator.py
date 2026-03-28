from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from uuid import UUID
from uuid import uuid4

from app.prompts import ADVISOR_SYSTEM_PROMPT
from app.prompts import build_advisor_prompt_variables
from app.prompts import build_advisor_user_payload
from app.repositories import UnitOfWork
from app.schemas.advisor import AdvisorRequest
from app.schemas.advisor import AdvisorResponse
from app.schemas.advisor import AnalysisSnapshot
from app.schemas.advisor import PersistenceMetadata
from app.schemas.advisor import SuggestedResponse
from app.schemas.rewrite import SafeRewriteRequest
from app.services.auth_service import AuthenticatedUser
from app.services.analysis_registry import AnalysisOwnershipError
from app.services.analysis_registry import analysis_registry
from app.services.emotional_linter import run_emotional_linter
from app.services.safe_memory import SafeMemoryService
from app.services.safe_rewrite_engine import SafeRewriteEngine
from app.services.user_identity import resolve_user_id
from providers.base import AIProvider
from providers.base import AIProviderError

logger = logging.getLogger(__name__)


class AnalysisNotFoundError(Exception):
    pass


@dataclass
class OrchestrationContext:
    user_id: UUID
    memory_opt_in: bool
    relationship_type: str
    user_style: str
    relationship_mode: str
    response_style: str
    contact_context: str | None
    analysis: AnalysisSnapshot | None
    risk_flags: list[str]
    emotional_context: str | None
    advisor_lineup: list[dict[str, str]]


class AdvisorOrchestrator:
    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    def run(
        self,
        payload: AdvisorRequest,
        *,
        current_user: AuthenticatedUser,
        uow: UnitOfWork | None,
    ) -> AdvisorResponse:
        started_at = datetime.now(UTC)
        sanitized_text = _sanitize_message(payload.message_text)
        context = self._build_context(payload, uow=uow)

        session_id, persistence = self._start_session(payload, context=context, uow=uow)
        self._track_event(
            uow,
            event_name="advisor_session_started",
            session_id=session_id,
            user_id=context.user_id,
            step="ingreso",
            mode=payload.mode,
            quick_mode=payload.quick_mode,
            save_session=payload.save_session,
            success=True,
        )

        try:
            if uow is not None:
                try:
                    uow.sessions.update_step(
                        session_id=session_id,
                        user_id=context.user_id,
                        current_step="respuesta" if payload.quick_mode else "analisis",
                    )
                except Exception:
                    pass

            variables = build_advisor_prompt_variables(
                message_text=sanitized_text,
                relationship_type=context.relationship_type,
                risk_flags=context.risk_flags,
                mode=payload.mode,
                emotional_context=context.emotional_context,
                user_style=context.user_style,
                contact_context=context.contact_context,
                advisor_lineup=context.advisor_lineup,
            )
            user_payload = build_advisor_user_payload(variables)
            responses = self._generate_safe_rewrites(
                sanitized_text=sanitized_text,
                context=context,
            )
            if not responses:
                raw_model_output = self._call_model(user_payload)
                advisor_ids = _advisor_ids_from_lineup(context.advisor_lineup)
                responses = _coerce_responses(raw_model_output, advisor_ids=advisor_ids)

            if payload.quick_mode:
                analysis = None
            else:
                analysis = context.analysis or AnalysisSnapshot(
                    summary="Analisis no disponible. Se genero respuesta con contexto minimo.",
                    risk_flags=context.risk_flags,
                )

            self._persist_outputs_and_memory(
                payload=payload,
                session_id=session_id,
                user_id=context.user_id,
                current_user=current_user,
                responses=responses,
                analysis=analysis,
                context=context,
                uow=uow,
                persistence=persistence,
            )
            self._save_session_result(
                payload=payload,
                session_id=session_id,
                user_id=context.user_id,
                responses=responses,
                analysis=analysis,
                uow=uow,
            )
            self._track_reply_generated_events(
                uow=uow,
                session_id=session_id,
                user_id=context.user_id,
                mode=payload.mode,
                quick_mode=payload.quick_mode,
                save_session=payload.save_session,
                responses=responses,
            )

            if uow is not None:
                try:
                    uow.sessions.mark_completed(session_id=session_id, user_id=context.user_id)
                except Exception:
                    try:
                        uow.sessions.mark_error(session_id=session_id, user_id=context.user_id)
                    except Exception:
                        pass

            duration_ms = int((datetime.now(UTC) - started_at).total_seconds() * 1000)
            self._track_event(
                uow,
                event_name="advisor_session_completed",
                session_id=session_id,
                user_id=context.user_id,
                step="respuesta",
                mode=payload.mode,
                quick_mode=payload.quick_mode,
                save_session=payload.save_session,
                success=True,
                duration_ms=duration_ms,
            )

            return AdvisorResponse(
                session_id=session_id,
                mode=payload.mode,
                quick_mode=payload.quick_mode,
                analysis=analysis,
                responses=responses,
                persistence=persistence,
                created_at=datetime.now(UTC),
            )
        except Exception:
            logger.exception(
                "advisor_generation_failed",
                extra={
                    "session_id": str(session_id),
                    "user_id": str(context.user_id),
                    "mode": payload.mode,
                    "quick_mode": payload.quick_mode,
                },
            )
            if uow is not None:
                try:
                    uow.sessions.mark_error(session_id=session_id, user_id=context.user_id)
                except Exception:
                    pass
            duration_ms = int((datetime.now(UTC) - started_at).total_seconds() * 1000)
            self._track_event(
                uow,
                event_name="advisor_session_failed",
                session_id=session_id,
                user_id=context.user_id,
                step="respuesta",
                mode=payload.mode,
                quick_mode=payload.quick_mode,
                save_session=payload.save_session,
                success=False,
                duration_ms=duration_ms,
            )
            fallback = _fallback_responses()
            self._track_reply_generated_events(
                uow=uow,
                session_id=session_id,
                user_id=context.user_id,
                mode=payload.mode,
                quick_mode=payload.quick_mode,
                save_session=payload.save_session,
                responses=fallback,
            )
            return AdvisorResponse(
                session_id=session_id,
                mode=payload.mode,
                quick_mode=payload.quick_mode,
                analysis=None if payload.quick_mode else context.analysis,
                responses=fallback,
                persistence=persistence,
                created_at=datetime.now(UTC),
            )

    def _build_context(self, payload: AdvisorRequest, *, uow: UnitOfWork | None) -> OrchestrationContext:
        context = payload.context or {}
        user_id = resolve_user_id(context.get("user_id"))
        memory_opt_in = bool(context.get("memory_opt_in", False))
        user_style = str(context.get("user_style") or "neutral_claro")
        relationship_mode = _normalize_relationship_mode(context.get("relationship_mode"))
        response_style = _normalize_response_style(context.get("response_style"))

        contact_context: str | None = (
            str(context.get("contact_context")).strip()
            if context.get("contact_context") is not None
            else None
        )
        relationship_type = payload.relationship_type
        advisor_lineup_raw = context.get("advisor_lineup")
        advisor_lineup = _normalize_advisor_lineup(advisor_lineup_raw)
        if payload.contact_id and uow is not None:
            try:
                contact = uow.contacts.get_by_id(user_id=user_id, contact_id=payload.contact_id)
                if contact:
                    relationship_type = str(contact.get("relationship_label") or relationship_type)
                    contact_context = str(contact.get("notes") or contact.get("name") or "")
            except Exception:
                pass

        risk_flags: list[str] = []
        emotional_context: str | None = None
        analysis = None
        if payload.analysis_id is not None:
            try:
                stored = analysis_registry.get_for_user(payload.analysis_id, user_id)
            except AnalysisOwnershipError:
                raise
            if stored is not None:
                risk_flags = [str(item.get("code", "")) for item in stored.risk_flags if item.get("code")]
                tone = stored.emotional_context.get("tone") if stored.emotional_context else None
                intent = (
                    stored.emotional_context.get("intent_guess")
                    if stored.emotional_context
                    else None
                )
                emotional_context = _compose_emotional_context(tone=tone, intent_guess=intent)
                analysis = AnalysisSnapshot(summary=stored.summary, risk_flags=risk_flags)
            else:
                persisted = self._load_persisted_analysis(
                    uow=uow,
                    analysis_id=payload.analysis_id,
                    user_id=user_id,
                )
                if persisted is None:
                    raise AnalysisNotFoundError("analysis_id not found or expired")
                risk_flags = persisted.risk_flags
                analysis = persisted

        if not risk_flags:
            inline_linter = run_emotional_linter(payload.message_text, quick_mode=payload.quick_mode)
            risk_flags = [item.code for item in inline_linter.risk_flags]
            emotional_context = _compose_emotional_context(
                tone=inline_linter.emotional_context.tone,
                intent_guess=inline_linter.emotional_context.intent_guess,
            )

        return OrchestrationContext(
            user_id=user_id,
            memory_opt_in=memory_opt_in,
            relationship_type=relationship_type,
            user_style=_adjust_user_style(user_style, risk_flags, mode=payload.mode),
            relationship_mode=relationship_mode,
            response_style=response_style,
            contact_context=contact_context,
            analysis=analysis,
            risk_flags=risk_flags,
            emotional_context=emotional_context,
            advisor_lineup=advisor_lineup,
        )

    def _start_session(
        self,
        payload: AdvisorRequest,
        *,
        context: OrchestrationContext,
        uow: UnitOfWork | None,
    ) -> tuple[UUID, PersistenceMetadata]:
        session_id = uuid4()
        persistence = PersistenceMetadata(
            save_session=payload.save_session,
            zero_retention_applied=not payload.save_session,
            outputs_persisted=False,
            memory_persisted=False,
        )
        if uow is None:
            return session_id, persistence

        try:
            created = uow.sessions.create_started(
                user_id=context.user_id,
                case_id=_resolve_optional_uuid(payload.case_id),
                contact_id=payload.contact_id,
                mode=payload.mode,
                quick_mode=payload.quick_mode,
                save_session=payload.save_session,
                source_type=(payload.source_type or "text"),
                original_input_text=payload.message_text,
                analysis_id=payload.analysis_id,
                current_step="ingreso",
                status="started",
            )
            session_id = UUID(str(created["id"]))
        except Exception:
            pass
        return session_id, persistence

    def _call_model(self, user_payload: str) -> str:
        model_input = (
            "SYSTEM:\n"
            f"{ADVISOR_SYSTEM_PROMPT}\n\n"
            "USER:\n"
            f"{user_payload}"
        )
        try:
            return self._provider.generate_answer(model_input)
        except AIProviderError:
            return ""
        except Exception:
            return ""

    def _generate_safe_rewrites(
        self,
        *,
        sanitized_text: str,
        context: OrchestrationContext,
    ) -> list[SuggestedResponse]:
        try:
            engine = SafeRewriteEngine(self._provider)
            rewritten = engine.rewrite(
                SafeRewriteRequest(
                    relationship_mode=context.relationship_mode,
                    response_style=context.response_style,
                    original_message=sanitized_text,
                )
            )
        except Exception:
            return []

        mapped: list[SuggestedResponse] = []
        for option in rewritten.responses:
            emotion = _emotion_for_rewrite_style(option.style)
            mapped.append(SuggestedResponse(text=option.text, emotion_label=emotion))
        return mapped[:3]

    def _persist_outputs_and_memory(
        self,
        *,
        payload: AdvisorRequest,
        session_id: UUID,
        user_id: UUID,
        current_user: AuthenticatedUser,
        responses: list[SuggestedResponse],
        analysis: AnalysisSnapshot | None,
        context: OrchestrationContext,
        uow: UnitOfWork | None,
        persistence: PersistenceMetadata,
    ) -> None:
        if uow is None:
            return

        if not payload.save_session:
            return

        try:
            for item in responses:
                uow.outputs.create_one(
                    session_id=session_id,
                    step="respuesta",
                    prompt_version=payload.prompt_version or "advisor_master_v1",
                    emotion_label=item.emotion_label,
                    output_text=item.text,
                    output_json={"analysis_summary": analysis.summary if analysis else None},
                )
            persistence.outputs_persisted = True
        except Exception:
            persistence.outputs_persisted = False

        if not (context.memory_opt_in and payload.save_session):
            return

        try:
            memory_items = [
                {
                    "memory_key": "preferred_style",
                    "memory_value": {"user_style": context.user_style},
                    "source": "derived",
                }
            ]
            uow.memory.upsert_items(
                user_id=user_id,
                contact_id=payload.contact_id,
                session_id=session_id,
                items=memory_items,
            )
            safe_memory_service = SafeMemoryService(self._provider)
            advisor_memory = safe_memory_service.build_advisor_session_memory(
                original_input_text=payload.message_text,
                suggested_responses=[item.text for item in responses],
                analysis_summary=analysis.summary if analysis else None,
                current_user=current_user,
            )
            uow.memory_items.upsert_by_source_reference(
                user_id=user_id,
                conversation_id=None,
                memory_type=advisor_memory.memory_type,
                safe_title=advisor_memory.safe_title,
                safe_summary=advisor_memory.safe_summary,
                tone=advisor_memory.tone,
                risk_level=advisor_memory.risk_level,
                recommended_next_step=advisor_memory.recommended_next_step,
                source_kind=advisor_memory.source_kind,
                is_sensitive=advisor_memory.is_sensitive,
                source_reference_id=session_id,
                memory_metadata=advisor_memory.metadata,
            )
            persistence.memory_persisted = True
        except Exception:
            persistence.memory_persisted = False

    def _track_event(
        self,
        uow: UnitOfWork | None,
        *,
        event_name: str,
        session_id: UUID,
        user_id: UUID,
        step: str | None,
        mode: str,
        quick_mode: bool,
        save_session: bool,
        success: bool,
        duration_ms: int | None = None,
        properties: dict[str, object] | None = None,
    ) -> None:
        if uow is None or uow.tracking is None:
            return
        uow.tracking.append(
            event_name=event_name,
            session_id=session_id,
            user_id=user_id,
            step=step,
            mode=mode,
            quick_mode=quick_mode,
            save_session=save_session,
            duration_ms=duration_ms,
            success=success,
            properties=properties,
        )

    def _save_session_result(
        self,
        *,
        payload: AdvisorRequest,
        session_id: UUID,
        user_id: UUID,
        responses: list[SuggestedResponse],
        analysis: AnalysisSnapshot | None,
        uow: UnitOfWork | None,
    ) -> None:
        if uow is None:
            return
        try:
            uow.sessions.save_advisor_result(
                session_id=session_id,
                user_id=user_id,
                analysis_id=payload.analysis_id,
                advisor_response_json={
                    "responses": [item.model_dump() for item in responses],
                    "analysis": analysis.model_dump() if analysis else None,
                },
            )
            logger.info(
                "advisor_persisted",
                extra={
                    "session_id": str(session_id),
                    "user_id": str(user_id),
                    "success": True,
                },
            )
        except Exception:
            logger.exception(
                "advisor_persistence_failed",
                extra={
                    "session_id": str(session_id),
                    "user_id": str(user_id),
                    "success": False,
                },
            )

    def _track_reply_generated_events(
        self,
        *,
        uow: UnitOfWork | None,
        session_id: UUID,
        user_id: UUID,
        mode: str,
        quick_mode: bool,
        save_session: bool,
        responses: list[SuggestedResponse],
    ) -> None:
        for index, item in enumerate(responses):
            self._track_event(
                uow,
                event_name="reply_generated",
                session_id=session_id,
                user_id=user_id,
                step="respuesta",
                mode=mode,
                quick_mode=quick_mode,
                save_session=save_session,
                success=True,
                properties={
                    "response_index": index,
                    "emotion_label": item.emotion_label,
                },
            )

    def _load_persisted_analysis(
        self,
        *,
        uow: UnitOfWork | None,
        analysis_id: UUID,
        user_id: UUID,
    ) -> AnalysisSnapshot | None:
        if uow is None:
            return None
        try:
            row = uow.analyses.get_by_id_for_user(analysis_id=analysis_id, user_id=user_id)
        except Exception:
            return None
        if row is None:
            return None
        raw = row.get("analysis_json")
        if not isinstance(raw, dict):
            return None
        summary = str(raw.get("summary") or "").strip()
        risk_raw = raw.get("risk_flags")
        risk_flags: list[str] = []
        if isinstance(risk_raw, list):
            for item in risk_raw:
                if not isinstance(item, dict):
                    continue
                code = str(item.get("code") or "").strip()
                if code:
                    risk_flags.append(code)
        if not summary:
            summary = "Analisis recuperado sin resumen."
        return AnalysisSnapshot(summary=summary, risk_flags=risk_flags)


def _sanitize_message(value: str) -> str:
    without_controls = re.sub(r"[\x00-\x1F\x7F]", " ", value)
    normalized = re.sub(r"\s+", " ", without_controls.strip())
    return normalized


def _parse_responses(raw_text: str, *, advisor_ids: list[str]) -> list[SuggestedResponse]:
    if not raw_text:
        return []
    parsed = _try_parse_json(raw_text)
    if parsed is None:
        return []
    response_items = parsed.get("responses")
    if not isinstance(response_items, list):
        return []

    by_advisor: dict[str, str] = {}
    for item in response_items:
        if not isinstance(item, dict):
            continue
        advisor = str(item.get("advisor", "")).strip().lower()
        text = str(item.get("text", "")).strip()
        if advisor and text:
            by_advisor[advisor] = text

    ordered = []
    for index, advisor in enumerate(advisor_ids):
        emotion = _emotion_for_advisor(advisor, index=index)
        text = by_advisor.get(advisor)
        if text:
            ordered.append(SuggestedResponse(text=text, emotion_label=emotion))
    return ordered


def _coerce_responses(raw_text: str, *, advisor_ids: list[str]) -> list[SuggestedResponse]:
    parsed = _parse_responses(raw_text, advisor_ids=advisor_ids)
    fallback_by_advisor = {item.emotion_label: item.text for item in _fallback_responses()}
    parsed_map = {item.emotion_label: item.text for item in parsed}

    ordered: list[SuggestedResponse] = []
    for emotion in ["empathetic", "assertive", "neutral"]:
        text = parsed_map.get(emotion) or fallback_by_advisor[emotion]
        ordered.append(SuggestedResponse(text=text, emotion_label=emotion))
    return ordered


def _try_parse_json(raw_text: str) -> dict[str, object] | None:
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


def _fallback_responses() -> list[SuggestedResponse]:
    return [
        SuggestedResponse(
            text="Entiendo que esto puede ser sensible. Propongo que coordinemos horarios con foco en bienestar y claridad.",
            emotion_label="empathetic",
        ),
        SuggestedResponse(
            text="Confirmame horario y lugar para mantener la coordinacion clara.",
            emotion_label="assertive",
        ),
        SuggestedResponse(
            text="Confirmemos horario por aqui y evitemos discusiones fuera de la logistica.",
            emotion_label="neutral",
        ),
    ]


def _compose_emotional_context(*, tone: str | None, intent_guess: str | None) -> str | None:
    if not tone and not intent_guess:
        return None
    if tone and intent_guess:
        return f"tone={tone}; intent={intent_guess}"
    return tone or intent_guess


def _adjust_user_style(base_style: str, risk_flags: list[str], *, mode: str) -> str:
    flags = set(risk_flags)
    adjusted = base_style
    if mode == "preventive":
        adjusted = f"{adjusted}|review_before_send"

    if "high_emotion" in flags:
        adjusted = f"{adjusted}|neutral_brief"
    if "custody_related" in flags:
        adjusted = f"{adjusted}|logistics_first"
    if "legal_sensitive" in flags:
        adjusted = f"{adjusted}|avoid_legal_claims"
    if "passive_aggressive" in flags:
        adjusted = f"{adjusted}|deescalate"
    return adjusted


def _normalize_advisor_lineup(value: object) -> list[dict[str, str]]:
    default = [
        {"id": "laura", "name": "Laura", "role": "Empatica", "tone": "calmado"},
        {"id": "robert", "name": "Robert", "role": "Estrategico", "tone": "directo"},
        {"id": "lidia", "name": "Lidia", "role": "Neutral", "tone": "objetivo"},
    ]
    if not isinstance(value, list):
        return default
    resolved: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        advisor_id = str(item.get("id", "")).strip().lower()
        if not advisor_id:
            continue
        resolved.append(
            {
                "id": advisor_id,
                "name": str(item.get("name") or advisor_id).strip() or advisor_id,
                "role": str(item.get("role") or "").strip(),
                "tone": str(item.get("tone") or "").strip(),
            }
        )
    if len(resolved) < 3:
        return default
    return resolved[:3]


def _advisor_ids_from_lineup(lineup: list[dict[str, str]]) -> list[str]:
    ids = [str(item.get("id", "")).strip().lower() for item in lineup if item.get("id")]
    if len(ids) < 3:
        return ["laura", "robert", "lidia"]
    return ids[:3]


def _emotion_for_advisor(advisor_id: str, *, index: int) -> str:
    by_id = {
        "laura": "empathetic",
        "robert": "assertive",
        "lidia": "neutral",
    }
    mapped = by_id.get(advisor_id)
    if mapped:
        return mapped
    by_index = ["empathetic", "assertive", "neutral"]
    return by_index[min(index, 2)]


def _resolve_optional_uuid(value: object) -> UUID | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return UUID(text)
    except ValueError:
        return None


def _normalize_relationship_mode(value: object) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"coparenting", "relationship_separation"}:
        return normalized
    return "relationship_separation"


def _normalize_response_style(value: object) -> str:
    normalized = str(value or "").strip().lower()
    aliases = {
        "estrictamente_parental": "strict_parental",
        "strict_parental": "strict_parental",
        "cordial_colaborativo": "cordial_collaborative",
        "cordial_collaborative": "cordial_collaborative",
        "amistoso_cercano": "friendly_close",
        "friendly_close": "friendly_close",
        "abierto_reconciliacion": "open_reconciliation",
        "open_reconciliation": "open_reconciliation",
    }
    return aliases.get(normalized, "cordial_collaborative")


def _emotion_for_rewrite_style(style: str) -> str:
    if style == "calm":
        return "empathetic"
    if style == "firm":
        return "assertive"
    return "neutral"


