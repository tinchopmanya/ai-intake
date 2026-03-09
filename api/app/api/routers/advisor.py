from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import status

from app.api.deps import get_ai_provider
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.advisor import AdvisorRequest
from app.schemas.advisor import AdvisorResponse
from app.services import AdvisorOrchestrator
from providers.base import AIProvider

router = APIRouter(prefix="/v1/advisor", tags=["advisor"])


@router.post(
    "",
    response_model=AdvisorResponse,
    status_code=status.HTTP_200_OK,
)
async def create_advisor_response(
    payload: AdvisorRequest,
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    provider: Annotated[AIProvider, Depends(get_ai_provider)],
) -> AdvisorResponse:
    orchestrator = AdvisorOrchestrator(provider=provider)
    return orchestrator.run(payload, uow=uow)

