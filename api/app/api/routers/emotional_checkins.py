from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status

from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.emotional_checkins import EmotionalCheckinCreateRequest
from app.schemas.emotional_checkins import EmotionalCheckinSummary
from app.schemas.emotional_checkins import EmotionalCheckinTodayStatusResponse
from app.services.auth_service import AuthenticatedUser

router = APIRouter(prefix="/v1/emotional-checkins", tags=["emotional_checkins"])


def _to_checkin_summary(row: dict) -> EmotionalCheckinSummary:
    return EmotionalCheckinSummary(
        id=row["id"],
        created_at=row["created_at"],
        mood_level=int(row["mood_level"]),
        confidence_level=int(row["confidence_level"]),
        recent_contact=bool(row["recent_contact"]),
    )


@router.get("/today", response_model=EmotionalCheckinTodayStatusResponse, status_code=status.HTTP_200_OK)
async def get_today_checkin_status(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> EmotionalCheckinTodayStatusResponse:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="emotional_checkin_persistence_unavailable",
        )

    row = uow.emotional_checkins.get_latest_for_user_today(user_id=current_user.id)
    if row is None:
        return EmotionalCheckinTodayStatusResponse(has_checkin_today=False, today_checkin=None)

    return EmotionalCheckinTodayStatusResponse(
        has_checkin_today=True,
        today_checkin=_to_checkin_summary(dict(row)),
    )


@router.post("", response_model=EmotionalCheckinSummary, status_code=status.HTTP_201_CREATED)
async def create_emotional_checkin(
    payload: EmotionalCheckinCreateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> EmotionalCheckinSummary:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="emotional_checkin_persistence_unavailable",
        )

    created = uow.emotional_checkins.create(
        user_id=current_user.id,
        mood_level=payload.mood_level,
        confidence_level=payload.confidence_level,
        recent_contact=payload.recent_contact,
    )
    return _to_checkin_summary(dict(created))
