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
from app.schemas.emotional_checkins import EmotionalHistoryDeleteResponse
from app.schemas.memory_items import ExPartnerHistoricalReportResponse
from app.schemas.memory_items import MemoryItemListResponse
from app.schemas.memory_items import MemoryItemSummary
from app.services.auth_service import AuthenticatedUser
from app.services.safe_memory import SafeMemoryService
from providers.base import AIProvider

router = APIRouter(prefix="/v1/memory-items", tags=["memory_items"])


def _to_memory_item_summary(row: dict) -> MemoryItemSummary:
    return MemoryItemSummary(
        id=row["id"],
        user_id=row["user_id"],
        conversation_id=row.get("conversation_id"),
        memory_type=row["memory_type"],
        safe_title=str(row.get("safe_title") or ""),
        safe_summary=str(row.get("safe_summary") or ""),
        tone=row.get("tone"),
        risk_level=row.get("risk_level"),
        recommended_next_step=row.get("recommended_next_step"),
        source_kind=row["source_kind"],
        is_sensitive=bool(row.get("is_sensitive", False)),
        source_reference_id=row.get("source_reference_id"),
        memory_metadata=dict(row.get("memory_metadata") or {}),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=MemoryItemListResponse, status_code=status.HTTP_200_OK)
async def list_memory_items(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    memory_type: str | None = Query(default=None),
    source_kind: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> MemoryItemListResponse:
    if uow is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="memory_persistence_unavailable")

    rows = uow.memory_items.list_by_user(
        user_id=current_user.id,
        memory_type=memory_type,
        source_kind=source_kind,
        limit=limit,
        offset=offset,
    )
    return MemoryItemListResponse(items=[_to_memory_item_summary(row) for row in rows])


@router.get(
    "/report/ex-partner",
    response_model=ExPartnerHistoricalReportResponse,
    status_code=status.HTTP_200_OK,
)
async def get_ex_partner_report(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    provider: Annotated[AIProvider, Depends(get_ai_provider)],
) -> ExPartnerHistoricalReportResponse:
    if uow is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="memory_persistence_unavailable")

    rows = uow.memory_items.list_by_user(
        user_id=current_user.id,
        memory_type="coparenting_exchange_summary",
        limit=200,
        offset=0,
    )
    safe_memory_service = SafeMemoryService(provider)
    return safe_memory_service.build_ex_partner_report(items=[dict(row) for row in rows])


@router.delete(
    "/history",
    response_model=EmotionalHistoryDeleteResponse,
    status_code=status.HTTP_200_OK,
)
async def delete_history(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> EmotionalHistoryDeleteResponse:
    if uow is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="memory_persistence_unavailable")

    emotional_checkins_deleted = uow.emotional_checkins.delete_all_for_user(user_id=current_user.id)
    memory_items_deleted = uow.memory_items.delete_all_for_user(user_id=current_user.id)
    return EmotionalHistoryDeleteResponse(
        emotional_checkins_deleted=emotional_checkins_deleted,
        memory_items_deleted=memory_items_deleted,
    )
