from datetime import UTC
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter
from fastapi import status

from app.schemas.advisor import AdvisorRequest
from app.schemas.advisor import AdvisorResponse
from app.schemas.advisor import AnalysisSnapshot
from app.schemas.advisor import PersistenceMetadata
from app.schemas.advisor import SuggestedResponse

router = APIRouter(prefix="/v1/advisor", tags=["advisor"])


@router.post(
    "",
    response_model=AdvisorResponse,
    status_code=status.HTTP_200_OK,
)
async def create_advisor_response(payload: AdvisorRequest) -> AdvisorResponse:
    zero_retention_applied = not payload.save_session
    outputs_persisted = payload.save_session

    context_memory_opt_in = bool((payload.context or {}).get("memory_opt_in"))
    memory_persisted = bool(payload.save_session and context_memory_opt_in)

    analysis = None
    if not payload.quick_mode:
        analysis = AnalysisSnapshot(
            summary="Analisis base para generar respuesta.",
            risk_flags=[],
        )

    responses = [
        SuggestedResponse(
            text="Gracias por compartir esto. Te propongo responder con calma y claridad.",
            emotion_label="empathetic",
        ),
        SuggestedResponse(
            text="Si queres, puedo ayudarte a redactar una version mas directa.",
            emotion_label="assertive",
        ),
    ]

    return AdvisorResponse(
        session_id=uuid4(),
        mode=payload.mode,
        quick_mode=payload.quick_mode,
        analysis=analysis,
        responses=responses,
        persistence=PersistenceMetadata(
            save_session=payload.save_session,
            zero_retention_applied=zero_retention_applied,
            outputs_persisted=outputs_persisted,
            memory_persisted=memory_persisted,
        ),
        created_at=datetime.now(UTC),
    )

