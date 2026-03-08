from fastapi import APIRouter

from providers.factory import build_provider
from repositories.in_memory_persistence import persistence_store
from schemas import AdvisorRequest
from schemas import AdvisorResponse
from services.advisor_service import AdvisorService

router = APIRouter()
advisor_service = AdvisorService(build_provider(), persistence_store)


@router.post("/v1/advisor", response_model=AdvisorResponse)
def advisor(payload: AdvisorRequest) -> AdvisorResponse:
    return advisor_service.advise(payload)
