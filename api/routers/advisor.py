from fastapi import APIRouter
from fastapi import HTTPException

from providers.factory import build_provider
from repositories.in_memory_persistence import persistence_store
from schemas import AdvisorConversationHistoryResponse
from schemas import AdvisorConversationListResponse
from schemas import AdvisorRequest
from schemas import AdvisorResponse
from services.advisor_service import AdvisorService

router = APIRouter()
advisor_service = AdvisorService(build_provider(), persistence_store)


@router.post("/v1/advisor", response_model=AdvisorResponse)
def advisor(payload: AdvisorRequest) -> AdvisorResponse:
    """Run advisor committee generation for a raw conversation payload."""
    return advisor_service.advise(payload)


@router.get(
    "/v1/advisor/conversations",
    response_model=AdvisorConversationListResponse,
)
def list_advisor_conversations(
    user_id: str = "user-main",
    contact_id: str | None = None,
) -> AdvisorConversationListResponse:
    """List advisor conversation sessions for a user and optional contact."""
    return advisor_service.list_conversations(user_id=user_id, contact_id=contact_id)


@router.get(
    "/v1/advisor/conversations/{conversation_id}",
    response_model=AdvisorConversationHistoryResponse,
)
def get_advisor_history(conversation_id: str) -> AdvisorConversationHistoryResponse:
    """Return advisor outputs and source messages for one advisor session."""
    response = advisor_service.get_conversation_history(conversation_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Advisor conversation not found")
    return response
