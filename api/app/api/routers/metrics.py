from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status

from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.metrics import MvpMetricsResponse
from app.services.auth_service import AuthenticatedUser

router = APIRouter(prefix="/v1/metrics", tags=["metrics"])


@router.get(
    "/mvp",
    response_model=MvpMetricsResponse,
    status_code=status.HTTP_200_OK,
)
async def get_mvp_metrics(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],  # noqa: ARG001
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> MvpMetricsResponse:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="metrics_unavailable",
        )

    snapshot = dict(uow.mvp_metrics.snapshot())
    replies_generated = int(snapshot.get("replies_generated") or 0)
    replies_copied = int(snapshot.get("replies_copied") or 0)
    adoption = (replies_copied / replies_generated) if replies_generated > 0 else 0.0

    return MvpMetricsResponse(
        users_logged_in=int(snapshot.get("users_logged_in") or 0),
        users_completed_onboarding=int(snapshot.get("users_completed_onboarding") or 0),
        wizard_sessions_created=int(snapshot.get("wizard_sessions_created") or 0),
        replies_generated=replies_generated,
        replies_copied=replies_copied,
        reply_adoption_rate=round(adoption, 3),
        cases_created=int(snapshot.get("cases_created") or 0),
        incidents_created=int(snapshot.get("incidents_created") or 0),
        case_exports=int(snapshot.get("case_exports") or 0),
        returning_users_7d=int(snapshot.get("returning_users_7d") or 0),
    )
