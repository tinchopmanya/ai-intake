from uuid import UUID
from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status

from app.api.deps import get_ai_provider
from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.conversations import ConversationCreateRequest
from app.schemas.conversations import ConversationListResponse
from app.schemas.conversations import ConversationSummary
from app.schemas.conversations import ConversationUpdateRequest
from app.schemas.messages import MessageListResponse
from app.schemas.messages import MessageSummary
from app.services.auth_service import AuthenticatedUser
from app.services.conversation_titles import get_safe_conversation_title
from app.services.safe_memory import SafeMemoryService
from providers.base import AIProvider

router = APIRouter(prefix="/v1/conversations", tags=["conversations"])


def _infer_memory_source_kind(source_text: str, requested_source_kind: str | None) -> str:
    normalized_kind = (requested_source_kind or "").strip().lower()
    if normalized_kind in {"ex_chat_capture", "ex_chat_pasted", "draft_analysis"}:
        return normalized_kind

    normalized_text = source_text.strip()
    line_count = len([line for line in normalized_text.splitlines() if line.strip()])
    if line_count >= 5 or any(char.isdigit() for char in normalized_text[:80]) and ":" in normalized_text:
        return "ex_chat_capture"
    if line_count <= 2 and len(normalized_text) <= 220:
        return "ex_chat_pasted"
    return "draft_analysis"


def _to_conversation_summary(row: dict) -> ConversationSummary:
    return ConversationSummary(
        id=row["id"],
        title=str(row.get("title") or "Nueva conversacion"),
        title_status=str(row.get("title_status") or "pending"),
        advisor_id=row.get("advisor_id"),
        created_at=row["created_at"],
        last_message_at=row["last_message_at"],
    )


def _to_message_summary(row: dict) -> MessageSummary:
    return MessageSummary(
        id=row["id"],
        conversation_id=row["conversation_id"],
        role=row["role"],
        content=str(row.get("content") or ""),
        message_type=row["message_type"],
        created_at=row["created_at"],
    )


@router.get("", response_model=ConversationListResponse, status_code=status.HTTP_200_OK)
async def list_conversations(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ConversationListResponse:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="conversation_persistence_unavailable",
        )
    rows = uow.conversations.list_by_user(user_id=current_user.id, limit=limit, offset=offset)
    return ConversationListResponse(conversations=[_to_conversation_summary(dict(row)) for row in rows])


@router.post("", response_model=ConversationSummary, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> ConversationSummary:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="conversation_persistence_unavailable",
        )
    created = uow.conversations.create(
        user_id=current_user.id,
        title="Nueva conversacion",
        title_status="pending",
        advisor_id=payload.advisor_id.strip() if payload.advisor_id and payload.advisor_id.strip() else None,
    )
    return _to_conversation_summary(dict(created))


@router.get(
    "/{conversation_id}/messages",
    response_model=MessageListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_conversation_messages(
    conversation_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> MessageListResponse:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="message_persistence_unavailable",
        )

    conversation = uow.conversations.get_by_id(
        user_id=current_user.id,
        conversation_id=conversation_id,
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="conversation_not_found")

    rows = uow.messages.list_by_conversation(conversation_id=conversation_id)
    return MessageListResponse(messages=[_to_message_summary(row) for row in rows])


@router.patch("/{conversation_id}", response_model=ConversationSummary, status_code=status.HTTP_200_OK)
async def update_conversation(
    conversation_id: UUID,
    payload: ConversationUpdateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    provider: Annotated[AIProvider, Depends(get_ai_provider)],
) -> ConversationSummary:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="conversation_persistence_unavailable",
        )

    safe_title = get_safe_conversation_title(
        source_text=payload.source_text,
        case_title=payload.case_title,
        analysis_summary=payload.analysis_summary,
    )
    updated = uow.conversations.update_title(
        user_id=current_user.id,
        conversation_id=conversation_id,
        title=safe_title,
        title_status="fallback",
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="conversation_not_found")

    safe_memory_service = SafeMemoryService(provider)
    source_kind = _infer_memory_source_kind(payload.source_text, payload.source_kind)
    default_case = uow.cases.get_default_for_user(user_id=current_user.id)
    case_contact_name = str(default_case.get("contact_name") or "").strip() if default_case else None
    memory_item = safe_memory_service.build_exchange_memory(
        source_text=payload.source_text,
        analysis_summary=payload.analysis_summary,
        current_user=current_user,
        source_kind=source_kind,
        case_contact_name=case_contact_name or None,
        child_names=payload.child_names,
    )
    uow.memory_items.upsert_by_source_reference(
        user_id=current_user.id,
        conversation_id=conversation_id,
        memory_type=memory_item.memory_type,
        safe_title=memory_item.safe_title,
        safe_summary=memory_item.safe_summary,
        tone=memory_item.tone,
        risk_level=memory_item.risk_level,
        recommended_next_step=memory_item.recommended_next_step,
        source_kind=memory_item.source_kind,
        is_sensitive=memory_item.is_sensitive,
        source_reference_id=conversation_id,
        memory_metadata=memory_item.metadata,
    )
    return _to_conversation_summary(dict(updated))
