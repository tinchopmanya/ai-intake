from datetime import UTC
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter
from fastapi import status

from app.schemas.analysis import AnalysisRequest
from app.schemas.analysis import AnalysisResponse

router = APIRouter(prefix="/v1/analysis", tags=["analysis"])


@router.post(
    "",
    response_model=AnalysisResponse,
    status_code=status.HTTP_200_OK,
)
async def create_analysis(payload: AnalysisRequest) -> AnalysisResponse:
    analysis_skipped = payload.quick_mode

    if analysis_skipped:
        summary = "Quick mode activo: analisis resumido."
        risk_flags: list[str] = []
        tone_detected = None
        suggested_emotion = "neutral"
    else:
        summary = "Analisis generado correctamente para el mensaje enviado."
        risk_flags = []
        tone_detected = "neutral"
        suggested_emotion = "empathetic"

    return AnalysisResponse(
        analysis_id=uuid4(),
        summary=summary,
        risk_flags=risk_flags,
        tone_detected=tone_detected,
        suggested_emotion_label=suggested_emotion,
        analysis_skipped=analysis_skipped,
        created_at=datetime.now(UTC),
    )

