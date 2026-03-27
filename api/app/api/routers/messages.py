from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status

from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.messages import MessageCreateRequest
from app.schemas.messages import MessageSummary
from app.services.auth_service import AuthenticatedUser

router = APIRouter(prefix="/v1/messages", tags=["messages"])


def _to_message_summary(row: dict) -> MessageSummary:
    return MessageSummary(
        id=row["id"],
        conversation_id=row["conversation_id"],
        role=row["role"],
        content=str(row.get("content") or ""),
        message_type=row["message_type"],
        created_at=row["created_at"],
    )


@router.post("", response_model=MessageSummary, status_code=status.HTTP_200_OK)
async def create_message(
    payload: MessageCreateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> MessageSummary:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="message_persistence_unavailable",
        )

    conversation = uow.conversations.get_by_id(
        user_id=current_user.id,
        conversation_id=payload.conversation_id,
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="conversation_not_found")

    existing = uow.messages.get_by_conversation_and_type(
        conversation_id=payload.conversation_id,
        message_type=payload.message_type,
    )
    if existing is not None:
        return _to_message_summary(dict(existing))

    created = uow.messages.create(
        conversation_id=payload.conversation_id,
        role=payload.role,
        content=payload.content.strip(),
        message_type=payload.message_type,
    )
    return _to_message_summary(dict(created))
