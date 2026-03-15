from typing import Annotated
from uuid import UUID
import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status

from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.incidents import IncidentCreateRequest
from app.schemas.incidents import IncidentListResponse
from app.schemas.incidents import IncidentSummary
from app.schemas.incidents import IncidentUpdateRequest
from app.services.auth_service import AuthenticatedUser

router = APIRouter(prefix="/v1/incidents", tags=["incidents"])
logger = logging.getLogger(__name__)


def _to_incident_summary(row: dict) -> IncidentSummary:
    return IncidentSummary(
        id=row["id"],
        case_id=row["case_id"],
        contact_id=row.get("contact_id"),
        incident_type=row["incident_type"],
        title=str(row.get("title") or ""),
        description=str(row.get("description") or ""),
        source_type=row["source_type"],
        related_analysis_id=row.get("related_analysis_id"),
        related_session_id=row.get("related_session_id"),
        incident_date=row["incident_date"],
        confirmed=bool(row.get("confirmed", False)),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _ensure_case_ownership(*, uow: UnitOfWork, user: AuthenticatedUser, case_id: UUID) -> None:
    case_row = uow.cases.get_by_id(user_id=user.id, case_id=case_id)
    if case_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found")


def _ensure_contact_ownership(
    *,
    uow: UnitOfWork,
    user: AuthenticatedUser,
    contact_id: UUID | None,
) -> None:
    if contact_id is None:
        return
    row = uow.contacts.get_by_id(user_id=user.id, contact_id=contact_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="contact_not_found")


def _ensure_related_ownership(
    *,
    uow: UnitOfWork,
    user: AuthenticatedUser,
    related_analysis_id: UUID | None,
    related_session_id: UUID | None,
) -> None:
    if related_analysis_id is not None:
        analysis = uow.analyses.get_by_id_for_user(
            analysis_id=related_analysis_id,
            user_id=user.id,
        )
        if analysis is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="related_analysis_not_found",
            )
    if related_session_id is not None:
        session = uow.sessions.get_by_id(
            session_id=related_session_id,
            user_id=user.id,
        )
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="related_session_not_found",
            )


@router.post("", response_model=IncidentSummary, status_code=status.HTTP_201_CREATED)
async def create_incident(
    payload: IncidentCreateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> IncidentSummary:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="incident_log_unavailable",
        )

    _ensure_case_ownership(uow=uow, user=current_user, case_id=payload.case_id)
    _ensure_contact_ownership(uow=uow, user=current_user, contact_id=payload.contact_id)
    _ensure_related_ownership(
        uow=uow,
        user=current_user,
        related_analysis_id=payload.related_analysis_id,
        related_session_id=payload.related_session_id,
    )

    try:
        created = uow.incidents.create(
            user_id=current_user.id,
            case_id=payload.case_id,
            contact_id=payload.contact_id,
            incident_type=payload.incident_type,
            title=payload.title.strip(),
            description=payload.description.strip(),
            source_type=payload.source_type,
            related_analysis_id=payload.related_analysis_id,
            related_session_id=payload.related_session_id,
            incident_date=payload.incident_date,
            confirmed=payload.confirmed,
        )
        uow.cases.append_summary_entry(
            user_id=current_user.id,
            case_id=payload.case_id,
            entry=f"Evento registrado: {payload.title.strip()} ({payload.incident_date.isoformat()})",
        )
        logger.info(
            "incident_created",
            extra={
                "incident_id": str(created["id"]),
                "user_id": str(current_user.id),
                "case_id": str(payload.case_id),
                "success": True,
            },
        )
    except Exception as exc:
        logger.exception(
            "incident_creation_failed",
            extra={
                "user_id": str(current_user.id),
                "case_id": str(payload.case_id),
                "success": False,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="incident_creation_failed",
        ) from exc
    return _to_incident_summary(dict(created))


@router.get("", response_model=IncidentListResponse, status_code=status.HTTP_200_OK)
async def list_incidents(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    case_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> IncidentListResponse:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="incident_log_unavailable",
        )
    if case_id is not None:
        _ensure_case_ownership(uow=uow, user=current_user, case_id=case_id)
    rows = uow.incidents.list_by_user(
        user_id=current_user.id,
        case_id=case_id,
        limit=limit,
        offset=offset,
    )
    return IncidentListResponse(incidents=[_to_incident_summary(dict(row)) for row in rows])


@router.get("/{incident_id}", response_model=IncidentSummary, status_code=status.HTTP_200_OK)
async def get_incident_by_id(
    incident_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> IncidentSummary:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="incident_log_unavailable",
        )
    row = uow.incidents.get_by_id(user_id=current_user.id, incident_id=incident_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="incident_not_found")
    return _to_incident_summary(dict(row))


@router.patch("/{incident_id}", response_model=IncidentSummary, status_code=status.HTTP_200_OK)
async def update_incident(
    incident_id: UUID,
    payload: IncidentUpdateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> IncidentSummary:
    if uow is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="incident_log_unavailable",
        )
    updated = uow.incidents.update(
        user_id=current_user.id,
        incident_id=incident_id,
        incident_type=payload.incident_type,
        title=payload.title.strip() if payload.title else None,
        description=payload.description.strip() if payload.description is not None else None,
        incident_date=payload.incident_date,
        confirmed=payload.confirmed,
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="incident_not_found")

    uow.cases.touch_activity(user_id=current_user.id, case_id=updated["case_id"])
    return _to_incident_summary(dict(updated))
