from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from uuid import UUID
from uuid import uuid4
from uuid import uuid5
from uuid import NAMESPACE_URL

from app.prompts import ADVISOR_SYSTEM_PROMPT
from app.prompts import build_advisor_prompt_variables
from app.prompts import build_advisor_user_payload
from app.repositories import UnitOfWork
from app.schemas.advisor import AdvisorRequest
from app.schemas.advisor import AdvisorResponse
from app.schemas.advisor import AnalysisSnapshot
from app.schemas.advisor import PersistenceMetadata
from app.schemas.advisor import SuggestedResponse
from app.services.analysis_registry import analysis_registry
from providers.base import AIProvider
from providers.base import AIProviderError


@dataclass
class OrchestrationContext:
    user_id: UUID
    memory_opt_in: bool
    relationship_type: str
    user_style: str
    contact_context: str | None
    analysis: AnalysisSnapshot | None
    risk_flags: list[str]
    emotional_context: str | None


class AdvisorOrchestrator:
    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    def run(self, payload: AdvisorRequest, *, uow: UnitOfWork | None) -> AdvisorResponse:
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
        )
        user_payload = build_advisor_user_payload(variables)

        raw_model_output = self._call_model(user_payload)
        responses = _parse_responses(raw_model_output)
        if not responses:
            responses = _fallback_responses()

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
            responses=responses,
            analysis=analysis,
            context=context,
            uow=uow,
            persistence=persistence,
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

    def _build_context(self, payload: AdvisorRequest, *, uow: UnitOfWork | None) -> OrchestrationContext:
        context = payload.context or {}
        user_id = _resolve_user_id(context.get("user_id"))
        memory_opt_in = bool(context.get("memory_opt_in", False))
        user_style = str(context.get("user_style") or "neutral_claro")

        contact_context: str | None = None
        relationship_type = payload.relationship_type
        if payload.contact_id and uow is not None:
            try:
                contact = uow.contacts.get_by_id(user_id=user_id, contact_id=payload.contact_id)
                if contact:
                    relationship_type = str(contact.get("relationship_label") or relationship_type)
                    contact_context = str(contact.get("notes") or contact.get("name") or "")
            except Exception:
                pass

        risk_flags = []
        emotional_context = None
        analysis = None
        if payload.analysis_id is not None:
            stored = analysis_registry.get(payload.analysis_id)
            if stored is not None:
                risk_flags = list(stored.risk_flags)
                emotional_context = stored.emotional_context
                analysis = AnalysisSnapshot(summary=stored.summary, risk_flags=stored.risk_flags)

        return OrchestrationContext(
            user_id=user_id,
            memory_opt_in=memory_opt_in,
            relationship_type=relationship_type,
            user_style=user_style,
            contact_context=contact_context,
            analysis=analysis,
            risk_flags=risk_flags,
            emotional_context=emotional_context,
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
                contact_id=payload.contact_id,
                mode=payload.mode,
                quick_mode=payload.quick_mode,
                save_session=payload.save_session,
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

    def _persist_outputs_and_memory(
        self,
        *,
        payload: AdvisorRequest,
        session_id: UUID,
        user_id: UUID,
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
        )


def _sanitize_message(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value.strip())
    return normalized


def _resolve_user_id(value: str | None) -> UUID:
    if value:
        try:
            return UUID(value)
        except ValueError:
            return uuid5(NAMESPACE_URL, value)
    return UUID("00000000-0000-0000-0000-000000000001")


def _parse_responses(raw_text: str) -> list[SuggestedResponse]:
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
    for advisor, emotion in [("laura", "empathetic"), ("robert", "assertive"), ("lidia", "neutral")]:
        text = by_advisor.get(advisor)
        if text:
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

