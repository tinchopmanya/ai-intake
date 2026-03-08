from fastapi import APIRouter

from providers.factory import build_provider
from schemas import AdvisorRequest
from schemas import AdvisorResponse
from services.advisor_service import AdvisorService

router = APIRouter()
advisor_service = AdvisorService(build_provider())


@router.post("/v1/advisor", response_model=AdvisorResponse)
def advisor(payload: AdvisorRequest) -> AdvisorResponse:
    return advisor_service.advise(payload)
