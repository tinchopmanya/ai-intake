from datetime import UTC
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter
from fastapi import status

from app.schemas.analysis import AnalysisRequest
from app.schemas.analysis import AnalysisResponse
from app.services.analysis_registry import StoredAnalysis
from app.services.analysis_registry import analysis_registry
from app.services.emotional_linter import extract_risk_codes
from app.services.emotional_linter import run_emotional_linter
from app.services.user_identity import resolve_user_id

router = APIRouter(prefix="/v1/analysis", tags=["analysis"])


@router.post(
    "",
    response_model=AnalysisResponse,
    status_code=status.HTTP_200_OK,
)
async def create_analysis(payload: AnalysisRequest) -> AnalysisResponse:
    analysis_skipped = payload.quick_mode
    context = payload.context or {}
    user_id = resolve_user_id(context.get("user_id"))
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
    return response

