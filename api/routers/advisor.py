from fastapi import APIRouter
from fastapi import HTTPException

from providers.factory import build_provider
from repositories.in_memory_persistence import persistence_store
from schemas import AdvisorConversationHistoryResponse
from schemas import AdvisorRequest
from schemas import AdvisorResponse
from services.advisor_service import AdvisorService

router = APIRouter()
advisor_service = AdvisorService(build_provider(), persistence_store)


@router.post("/v1/advisor", response_model=AdvisorResponse)
def advisor(payload: AdvisorRequest) -> AdvisorResponse:
    return advisor_service.advise(payload)


@router.get(
    "/v1/advisor/conversations/{conversation_id}",
    response_model=AdvisorConversationHistoryResponse,
)
def get_advisor_history(conversation_id: str) -> AdvisorConversationHistoryResponse:
    response = advisor_service.get_conversation_history(conversation_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Advisor conversation not found")
    return response
