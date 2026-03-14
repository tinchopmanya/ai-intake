from typing import Annotated

from datetime import UTC
from datetime import datetime
from uuid import UUID
from uuid import uuid4

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
import logging

from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.analysis import AnalysisRequest
from app.schemas.analysis import AnalysisResponse
from app.services.auth_service import AuthenticatedUser
from app.services.analysis_registry import StoredAnalysis
from app.services.analysis_registry import analysis_registry
from app.services.emotional_linter import extract_risk_codes
from app.services.emotional_linter import run_emotional_linter

router = APIRouter(prefix="/v1/analysis", tags=["analysis"])
logger = logging.getLogger(__name__)


@router.post(
    "",
    response_model=AnalysisResponse,
    status_code=status.HTTP_200_OK,
)
async def create_analysis(
    payload: AnalysisRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> AnalysisResponse:
    """Analyze a candidate outbound message and return emotional/risk signals."""
    if payload.case_id is not None:
        if uow is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="case_memory_unavailable",
            )
        case_row = uow.cases.get_by_id(user_id=current_user.id, case_id=payload.case_id)
        if case_row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found")

    analysis_skipped = payload.quick_mode
    user_id = current_user.id
    linter_result = run_emotional_linter(
        payload.message_text,
        quick_mode=analysis_skipped,
    )

    risk_flags = [
        AnalysisResponse.RiskFlag(
            code=item.code,
            severity=item.severity,
            confidence=item.confidence,
            evidence=item.evidence,
        )
        for item in linter_result.risk_flags
    ]
    emotional_context = AnalysisResponse.EmotionalContext(
        tone=linter_result.emotional_context.tone,
        intent_guess=linter_result.emotional_context.intent_guess,
    )
    ui_alerts = [
        AnalysisResponse.UiAlert(level=item.level, message=item.message)
        for item in linter_result.ui_alerts
    ]
    risk_codes = extract_risk_codes(linter_result.risk_flags)
    suggested_emotion = "empathetic"
    if "high_emotion" in risk_codes or "urgency_conflict" in risk_codes:
        suggested_emotion = "calm"
    if "legal_sensitive" in risk_codes:
        suggested_emotion = "assertive"

    response = AnalysisResponse(
        analysis_id=uuid4(),
        summary=linter_result.summary,
        risk_flags=risk_flags,
        emotional_context=emotional_context,
        ui_alerts=ui_alerts,
        tone_detected=linter_result.emotional_context.tone,
        suggested_emotion_label=suggested_emotion,
        analysis_skipped=analysis_skipped,
        created_at=datetime.now(UTC),
    )
    analysis_registry.put(
        StoredAnalysis(
            analysis_id=response.analysis_id,
            user_id=user_id,
            summary=response.summary,
            risk_flags=[item.model_dump() for item in response.risk_flags],
            emotional_context=response.emotional_context.model_dump(),
            ui_alerts=[item.model_dump() for item in response.ui_alerts],
            created_at=response.created_at,
            expires_at=analysis_registry.build_expires_at(response.created_at),
        )
    )
    if uow is not None:
        try:
            uow.analyses.create(
                analysis_id=response.analysis_id,
                user_id=user_id,
                case_id=payload.case_id,
                contact_id=payload.contact_id,
                source_type=payload.source_type,
                input_text=payload.message_text,
                analysis_json=response.model_dump(mode="json"),
            )
            if payload.case_id is not None:
                uow.cases.append_summary_entry(
                    user_id=user_id,
                    case_id=payload.case_id,
                    entry=f"Analisis: {response.summary}",
                )
        except Exception as exc:
            logger.exception("Failed to persist analysis result: analysis_id=%s", response.analysis_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="analysis_persistence_failed",
            ) from exc
    return response


@router.get(
    "/{analysis_id}",
    response_model=AnalysisResponse,
    status_code=status.HTTP_200_OK,
)
async def get_analysis_by_id(
    analysis_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> AnalysisResponse:
    """Return an analysis result for current user by id."""
    stored = analysis_registry.get_for_user(analysis_id, current_user.id)
    if stored is not None:
        return AnalysisResponse(
            analysis_id=stored.analysis_id,
            summary=stored.summary,
            risk_flags=[AnalysisResponse.RiskFlag.model_validate(item) for item in stored.risk_flags],
            emotional_context=AnalysisResponse.EmotionalContext.model_validate(
                stored.emotional_context
            ),
            ui_alerts=[AnalysisResponse.UiAlert.model_validate(item) for item in stored.ui_alerts],
            tone_detected=stored.emotional_context.get("tone"),
            suggested_emotion_label=None,
            analysis_skipped=False,
            created_at=stored.created_at,
        )

    if uow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="analysis_not_found")

    row = uow.analyses.get_by_id_for_user(analysis_id=analysis_id, user_id=current_user.id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="analysis_not_found")

    payload = row.get("analysis_json")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="analysis_invalid")
    return AnalysisResponse.model_validate(payload)
