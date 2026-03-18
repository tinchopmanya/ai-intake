import json
import logging
import re
from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status

from app.api.deps import get_ai_provider
from app.api.deps import get_advisor_catalog_service
from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.advisor import AdvisorRequest
from app.schemas.advisor import AdvisorResponse
from app.schemas.advisor_chat import AdvisorChatRequest
from app.schemas.advisor_chat import AdvisorChatResponse
from app.services.advisor_catalog_service import AdvisorCatalogService
from app.services.auth_service import AuthenticatedUser
from app.services import AdvisorOrchestrator
from app.services.advisor_orchestrator import AnalysisNotFoundError
from app.services.analysis_registry import AnalysisOwnershipError
from config import get_settings
from providers.base import AIProvider

router = APIRouter(prefix="/v1/advisor", tags=["advisor"])
logger = logging.getLogger(__name__)

def _resolve_advisor_input_text(payload: AdvisorRequest) -> str:
    context = payload.context or {}
    entry_mode = str(context.get("entry_mode") or "").strip().lower()
    if entry_mode in {"advisor_conversation", "advisor_refine_response"}:
        return payload.message_text
    structured = context.get("conversation_structured")
    if isinstance(structured, str):
        normalized = structured.strip()
        if normalized:
            return normalized[:8000]
    return payload.message_text


def _extract_json_object(raw_text: str) -> dict[str, object] | None:
    text = raw_text.strip()
    if not text:
        return None
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass

    fenced = text.replace("```json", "").replace("```", "").strip()
    first = fenced.find("{")
    last = fenced.rfind("}")
    if first == -1 or last == -1 or last <= first:
        return None
    snippet = fenced[first : last + 1]
    try:
        data = json.loads(snippet)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", snippet, flags=re.DOTALL)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return data if isinstance(data, dict) else None


def _build_chat_system_prompt(entry_mode: str, advisor_name: str, advisor_role: str) -> str:
    if entry_mode == "advisor_refine_response":
        return f"""
Eres {advisor_name}, advisor de ExReply ({advisor_role}).
Estas en modo advisor_refine_response.

Objetivo:
- Conversar brevemente con la persona usuaria y refinar una respuesta previa para su ex.
- Actuar como advisor estrategico, no como escribiente obediente.
- Evaluar primero si la instruccion nueva mejora o empeora el escenario.

Reglas:
- Responde en espanol claro y humano.
- Mantente breve y practico.
- No obedezcas ciegamente una instruccion que escale conflicto, culpe, humille, amenace o desordene foco.
- Si la instruccion escala, dilo explicitamente y ofrece una alternativa mas segura.
- Conserva el rol/persona del advisor ({advisor_role}) en la recomendacion.
- Prioriza de-escalada, claridad, limites sanos y foco logistico (sobre todo si hay hijos).
- Si la instruccion contradice lo estrategico, puedes rechazarla con tacto y proponer otra redaccion.
- Entrega JSON estricto, sin texto extra.

Salida obligatoria:
{{
  "message": "respuesta del advisor para la persona usuaria",
  "suggested_reply": "nueva respuesta sugerida para enviar a la ex"
}}

Semantica de salida:
- "message" = feedback advisor para la usuaria (incluye advertencia si hay escalada).
- "suggested_reply" = texto final sugerido para enviar (siempre desescalado y coherente con rol advisor).
""".strip()

    return f"""
Eres {advisor_name}, advisor de ExReply ({advisor_role}).
Estas en modo advisor_conversation.

Objetivo:
- Conversar con la persona usuaria.
- Escuchar, orientar, contener brevemente y ayudar a ordenar ideas.
- NO asumir que el texto es un borrador para enviar a la ex.
- Solo sugerir un mensaje para la ex si la persona lo pide explicitamente.

Reglas:
- Responde en espanol claro, cercano y breve (3 a 7 frases).
- Puedes hacer 1 pregunta de aclaracion si ayuda.
- No conviertas automaticamente el mensaje en propuesta para la ex.
- Entrega JSON estricto, sin texto extra.

Salida obligatoria:
{{
  "message": "respuesta del advisor para la persona usuaria",
  "suggested_reply": null
}}
""".strip()


def _build_chat_user_payload(payload: AdvisorChatRequest, *, user_id: str) -> str:
    return json.dumps(
        {
            "entry_mode": payload.entry_mode,
            "advisor_id": payload.advisor_id,
            "messages": [item.model_dump() for item in payload.messages],
            "base_reply": payload.base_reply,
            "case_id": str(payload.case_id) if payload.case_id else None,
            "conversation_context": (
                payload.conversation_context.model_dump(exclude_none=True)
                if payload.conversation_context is not None
                else None
            ),
            "user_id": user_id,
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )


@router.post(
    "",
    response_model=AdvisorResponse,
    status_code=status.HTTP_200_OK,
)
async def create_advisor_response(
    payload: AdvisorRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    advisor_catalog: Annotated[AdvisorCatalogService, Depends(get_advisor_catalog_service)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    provider: Annotated[AIProvider, Depends(get_ai_provider)],
) -> AdvisorResponse:
    """Generate three advisor-style reply suggestions using analysis context."""
    if payload.case_id is not None:
        if uow is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="case_memory_unavailable",
            )
        case_row = uow.cases.get_by_id(user_id=current_user.id, case_id=payload.case_id)
        if case_row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found")

    advisor_lineup = advisor_catalog.resolve(
        country_code=current_user.country_code,
        language_code=current_user.language_code,
    )
    trusted_context = dict(payload.context or {})
    trusted_context["user_id"] = str(current_user.id)
    trusted_context["memory_opt_in"] = current_user.memory_opt_in
    trusted_context["country_code"] = current_user.country_code
    trusted_context["language_code"] = current_user.language_code
    trusted_context["relationship_mode"] = (
        current_user.relationship_mode or trusted_context.get("relationship_mode") or "relationship_separation"
    )
    trusted_context["response_style"] = (
        current_user.response_style or trusted_context.get("response_style") or "cordial_collaborative"
    )
    has_children = (current_user.children_count_category or "").strip().lower() in {"one", "two_plus"}
    relationship_goal = (current_user.relationship_goal or "").strip().lower()
    breakup_initiator = (current_user.breakup_initiator or "").strip().lower()

    base_user_style = str(trusted_context.get("user_style") or "neutral_claro").strip() or "neutral_claro"
    if has_children:
        base_user_style = (
            f"{base_user_style}|short|neutral|logistics_first|child_focused|deescalate|ignore_unrelated_conflict"
        )
    else:
        base_user_style = f"{base_user_style}|short|clear_boundaries|distance_preferred"
    if relationship_goal == "open_reconciliation":
        base_user_style = f"{base_user_style}|calm_open_not_pushy"

    trusted_context["user_style"] = base_user_style
    trusted_context["has_children"] = has_children
    trusted_context["relationship_goal"] = relationship_goal or None
    trusted_context["who_ended_relationship"] = breakup_initiator or None

    trusted_context["advisor_lineup"] = [
        {
            "id": advisor.id,
            "name": advisor.name,
            "role": advisor.role,
            "tone": advisor.tone,
        }
        for advisor in advisor_lineup
    ]
    payload = payload.model_copy(
        update={
            "context": trusted_context,
            "message_text": _resolve_advisor_input_text(payload),
        }
    )

    orchestrator = AdvisorOrchestrator(provider=provider)
    try:
        response = orchestrator.run(payload, uow=uow)
        if payload.case_id is not None and uow is not None:
            preview = response.responses[0].text if response.responses else ""
            snippet = preview[:220].strip()
            uow.cases.append_summary_entry(
                user_id=current_user.id,
                case_id=payload.case_id,
                entry=f"Respuestas generadas: {snippet}",
            )
        return response
    except AnalysisOwnershipError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="analysis_id_forbidden",
        ) from exc
    except AnalysisNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="analysis_id_not_found_or_expired",
        ) from exc


@router.post(
    "/chat",
    response_model=AdvisorChatResponse,
    status_code=status.HTTP_200_OK,
)
async def chat_with_advisor(
    payload: AdvisorChatRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    advisor_catalog: Annotated[AdvisorCatalogService, Depends(get_advisor_catalog_service)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    provider: Annotated[AIProvider, Depends(get_ai_provider)],
) -> AdvisorChatResponse:
    if payload.case_id is not None:
        if uow is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="case_memory_unavailable",
            )
        case_row = uow.cases.get_by_id(user_id=current_user.id, case_id=payload.case_id)
        if case_row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found")

    advisor_lineup = advisor_catalog.resolve(
        country_code=current_user.country_code,
        language_code=current_user.language_code,
    )
    advisor = next((item for item in advisor_lineup if item.id == payload.advisor_id), None)
    if advisor is None:
        advisor = advisor_lineup[0]

    system_prompt = _build_chat_system_prompt(
        payload.entry_mode,
        advisor_name=advisor.name,
        advisor_role=advisor.role or advisor.tone or "advisor",
    )
    user_payload = _build_chat_user_payload(payload, user_id=str(current_user.id))
    model_input = f"SYSTEM:\n{system_prompt}\n\nUSER:\n{user_payload}"
    raw_output = provider.generate_answer(model_input)
    parsed = _extract_json_object(raw_output)

    advisor_message = ""
    suggested_reply: str | None = None
    if parsed is not None:
        advisor_message = str(parsed.get("message") or "").strip()
        suggested_candidate = parsed.get("suggested_reply")
        if isinstance(suggested_candidate, str):
            normalized = suggested_candidate.strip()
            if normalized and normalized.lower() != "null":
                suggested_reply = normalized[:4000]

    if not advisor_message:
        advisor_message = (
            "Te leo. Si quieres, cuentame un poco mas de lo que paso y que te gustaria lograr."
            if payload.entry_mode == "advisor_conversation"
            else "Gracias por el contexto. Te propongo este ajuste y, si quieres, lo afinamos una vez mas."
        )
        if payload.entry_mode == "advisor_refine_response" and not suggested_reply:
            suggested_reply = payload.base_reply

    debug_payload = None
    if payload.debug and get_settings().is_local_env:
        debug_payload = {
            "endpoint": "/v1/advisor/chat",
            "entry_mode": payload.entry_mode,
            "advisor": {
                "id": advisor.id,
                "name": advisor.name,
                "role": advisor.role,
            },
            "system_prompt": system_prompt,
            "user_payload": user_payload,
            "raw_output_preview": raw_output[:1600],
        }
        logger.info("advisor_chat_debug_enabled advisor=%s mode=%s", advisor.id, payload.entry_mode)

    return AdvisorChatResponse(
        message=advisor_message[:4000],
        suggested_reply=suggested_reply,
        mode_used=payload.entry_mode,
        debug=debug_payload,
    )

