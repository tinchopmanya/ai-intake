from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status

from app.api.deps import get_ai_provider
from app.api.deps import get_advisor_catalog_service
from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.advisor import AdvisorRequest
from app.schemas.advisor import AdvisorResponse
from app.services.advisor_catalog_service import AdvisorCatalogService
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
    advisor_catalog: Annotated[AdvisorCatalogService, Depends(get_advisor_catalog_service)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    provider: Annotated[AIProvider, Depends(get_ai_provider)],
) -> AdvisorResponse:
    """Generate three advisor-style reply suggestions using analysis context."""
    if payload.case_id is not None:
        if uow is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="case_memory_unavailable",
            )
        case_row = uow.cases.get_by_id(user_id=current_user.id, case_id=payload.case_id)
        if case_row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found")

    advisor_lineup = advisor_catalog.resolve(
        country_code=current_user.country_code,
        language_code=current_user.language_code,
    )
    trusted_context = dict(payload.context or {})
    trusted_context["user_id"] = str(current_user.id)
    trusted_context["memory_opt_in"] = current_user.memory_opt_in
    trusted_context["country_code"] = current_user.country_code
    trusted_context["language_code"] = current_user.language_code
    trusted_context["relationship_mode"] = (
        current_user.relationship_mode or trusted_context.get("relationship_mode") or "relationship_separation"
    )
    trusted_context["response_style"] = (
        current_user.response_style or trusted_context.get("response_style") or "cordial_collaborative"
    )
    has_children = (current_user.children_count_category or "").strip().lower() in {"one", "two_plus"}
    relationship_goal = (current_user.relationship_goal or "").strip().lower()
    breakup_initiator = (current_user.breakup_initiator or "").strip().lower()

    base_user_style = str(trusted_context.get("user_style") or "neutral_claro").strip() or "neutral_claro"
    if has_children:
        base_user_style = (
            f"{base_user_style}|short|neutral|logistics_first|child_focused|deescalate|ignore_unrelated_conflict"
        )
    else:
        base_user_style = f"{base_user_style}|short|clear_boundaries|distance_preferred"
    if relationship_goal == "open_reconciliation":
        base_user_style = f"{base_user_style}|calm_open_not_pushy"

    trusted_context["user_style"] = base_user_style
    trusted_context["has_children"] = has_children
    trusted_context["relationship_goal"] = relationship_goal or None
    trusted_context["who_ended_relationship"] = breakup_initiator or None

    trusted_context["advisor_lineup"] = [
        {
            "id": advisor.id,
            "name": advisor.name,
            "role": advisor.role,
            "tone": advisor.tone,
        }
        for advisor in advisor_lineup
    ]
    payload = payload.model_copy(update={"context": trusted_context})

    orchestrator = AdvisorOrchestrator(provider=provider)
    try:
        response = orchestrator.run(payload, uow=uow)
        if payload.case_id is not None and uow is not None:
            preview = response.responses[0].text if response.responses else ""
            snippet = preview[:220].strip()
            uow.cases.append_summary_entry(
                user_id=current_user.id,
                case_id=payload.case_id,
                entry=f"Respuestas generadas: {snippet}",
            )
        return response
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

