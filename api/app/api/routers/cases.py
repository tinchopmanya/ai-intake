from typing import Annotated
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi import status

from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.cases import CaseCreateRequest
from app.schemas.cases import CaseListResponse
from app.schemas.cases import CaseSummary
from app.schemas.cases import CaseUpdateRequest
from app.schemas.analysis import RelationshipType
from app.services.auth_service import AuthenticatedUser

router = APIRouter(prefix="/v1/cases", tags=["cases"])

_ALLOWED_RELATIONSHIP_TYPES: set[RelationshipType] = {
    "pareja",
    "familia",
    "amistad",
    "trabajo",
    "cliente",
    "otro",
}

_LEGACY_RELATIONSHIP_MAP: dict[str, RelationshipType] = {
    "coparenting": "otro",
    "relationship_separation": "pareja",
}


def _normalize_relationship_type(value: object) -> RelationshipType | None:
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if not normalized:
        return None
    if normalized in _ALLOWED_RELATIONSHIP_TYPES:
        return normalized  # type: ignore[return-value]
    return _LEGACY_RELATIONSHIP_MAP.get(normalized, "otro")


def _to_case_summary(row: dict) -> CaseSummary:
    return CaseSummary(
        id=row["id"],
        title=str(row.get("title") or ""),
        contact_name=row.get("contact_name"),
        relationship_type=_normalize_relationship_type(row.get("relationship_label")),
        summary=str(row.get("summary") or ""),
        contact_id=row.get("contact_id"),
        last_activity_at=row["last_activity_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _ensure_contact_ownership(
    *,
    uow: UnitOfWork,
    user: AuthenticatedUser,
    contact_id,
) -> None:
    if contact_id is None:
        return
    contact = uow.contacts.get_by_id(user_id=user.id, contact_id=contact_id)
    if contact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="contact_not_found")


@router.post("", response_model=CaseSummary, status_code=status.HTTP_201_CREATED)
async def create_case(
    payload: CaseCreateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> CaseSummary:
    if uow is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="case_memory_unavailable")

    _ensure_contact_ownership(uow=uow, user=current_user, contact_id=payload.contact_id)
    created = uow.cases.create(
        user_id=current_user.id,
        title=payload.title.strip(),
        contact_name=payload.contact_name.strip() if payload.contact_name else None,
        relationship_label=payload.relationship_type,
        summary=payload.summary.strip() if payload.summary else "",
        contact_id=payload.contact_id,
    )
    return _to_case_summary(dict(created))


@router.get("", response_model=CaseListResponse, status_code=status.HTTP_200_OK)
async def list_cases(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> CaseListResponse:
    if uow is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="case_memory_unavailable")
    rows = uow.cases.list_by_user(user_id=current_user.id, limit=limit, offset=offset)
    return CaseListResponse(cases=[_to_case_summary(dict(row)) for row in rows])


@router.get("/{case_id}", response_model=CaseSummary, status_code=status.HTTP_200_OK)
async def get_case_by_id(
    case_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> CaseSummary:
    if uow is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="case_memory_unavailable")
    row = uow.cases.get_by_id(user_id=current_user.id, case_id=case_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found")
    return _to_case_summary(dict(row))


@router.patch("/{case_id}", response_model=CaseSummary, status_code=status.HTTP_200_OK)
async def update_case(
    case_id: UUID,
    payload: CaseUpdateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> CaseSummary:
    if uow is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="case_memory_unavailable")
    _ensure_contact_ownership(uow=uow, user=current_user, contact_id=payload.contact_id)
    updated = uow.cases.update(
        user_id=current_user.id,
        case_id=case_id,
        title=payload.title.strip() if payload.title else None,
        contact_name=payload.contact_name.strip() if payload.contact_name else None,
        relationship_label=payload.relationship_type,
        summary=payload.summary.strip() if payload.summary else None,
        contact_id=payload.contact_id,
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="case_not_found")
    return _to_case_summary(dict(updated))
