from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status

from app.api.deps import get_ai_provider
from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.advisor import AdvisorRequest
from app.schemas.advisor import AdvisorResponse
from app.services.auth_service import AuthenticatedUser
from app.services import AdvisorOrchestrator
from app.services.advisor_orchestrator import AnalysisNotFoundError
from app.services.analysis_registry import AnalysisOwnershipError
from providers.base import AIProvider

router = APIRouter(prefix="/v1/advisor", tags=["advisor"])


@router.post(
    "",
    response_model=AdvisorResponse,
    status_code=status.HTTP_200_OK,
)
async def create_advisor_response(
    payload: AdvisorRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    provider: Annotated[AIProvider, Depends(get_ai_provider)],
) -> AdvisorResponse:
    """Generate three advisor-style reply suggestions using analysis context."""
    trusted_context = dict(payload.context or {})
    trusted_context["user_id"] = str(current_user.id)
    trusted_context["memory_opt_in"] = current_user.memory_opt_in
    trusted_context["country_code"] = current_user.country_code
    trusted_context["language_code"] = current_user.language_code
    payload = payload.model_copy(update={"context": trusted_context})

    orchestrator = AdvisorOrchestrator(provider=provider)
    try:
        return orchestrator.run(payload, uow=uow)
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

