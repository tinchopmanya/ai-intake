from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status

from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.conversations import ConversationCreateRequest
from app.schemas.conversations import ConversationListResponse
from app.schemas.conversations import ConversationSummary
from app.services.auth_service import AuthenticatedUser

router = APIRouter(prefix="/v1/conversations", tags=["conversations"])


def _to_conversation_summary(row: dict) -> ConversationSummary:
    return ConversationSummary(
        id=row["id"],
        title=str(row.get("title") or "Nueva conversacion"),
        title_status=str(row.get("title_status") or "pending"),
        advisor_id=row.get("advisor_id"),
        created_at=row["created_at"],
        last_message_at=row["last_message_at"],
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
