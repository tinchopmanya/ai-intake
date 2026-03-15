from typing import Annotated
from typing import Literal
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from pydantic import BaseModel
from pydantic import Field

from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.services.auth_service import AuthenticatedUser

router = APIRouter(prefix="/v1/events", tags=["events"])


class WizardEventRequest(BaseModel):
    event_name: Literal["reply_copied", "case_exported"]
    session_id: UUID | None = None
    case_id: UUID | None = None
    analysis_id: UUID | None = None
    advisor_id: str | None = Field(default=None, min_length=1, max_length=80)
    response_index: int | None = Field(default=None, ge=0, le=20)


class WizardEventResponse(BaseModel):
    accepted: bool
    persisted: bool


@router.post(
    "",
    response_model=WizardEventResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def append_wizard_event(
    payload: WizardEventRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> WizardEventResponse:
    if uow is None or uow.tracking is None:
        return WizardEventResponse(accepted=True, persisted=False)

    if payload.event_name == "reply_copied":
        if payload.session_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="session_id_required")

        session = uow.sessions.get_by_id(session_id=payload.session_id, user_id=current_user.id)
        if session is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session_not_found")

        normalized_advisor_id = (payload.advisor_id or "").strip().lower() or None
        if normalized_advisor_id:
            uow.sessions.set_selected_advisor(
                session_id=payload.session_id,
                user_id=current_user.id,
                selected_advisor_id=normalized_advisor_id,
            )

        persisted = uow.tracking.append(
            event_name=payload.event_name,
            session_id=payload.session_id,
            user_id=current_user.id,
            step="respuesta",
            mode=session.get("mode"),
            quick_mode=bool(session.get("quick_mode")),
            save_session=bool(session.get("save_session")),
            success=True,
            properties={
                "analysis_id": str(payload.analysis_id) if payload.analysis_id else None,
                "advisor_id": normalized_advisor_id,
                "response_index": payload.response_index,
            },
        )
        return WizardEventResponse(accepted=True, persisted=bool(persisted))

    if payload.case_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="case_id_required")
    case_row = uow.cases.get_by_id(user_id=current_user.id, case_id=payload.case_id)
    if case_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found")
    persisted = uow.tracking.append(
        event_name=payload.event_name,
        session_id=None,
        user_id=current_user.id,
        step="respuesta",
        mode=None,
        quick_mode=None,
        save_session=None,
        success=True,
        properties={
            "case_id": str(payload.case_id),
        },
    )
    return WizardEventResponse(accepted=True, persisted=bool(persisted))
