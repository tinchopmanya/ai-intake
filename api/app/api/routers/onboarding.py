from typing import Annotated
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status

from app.api.deps import get_auth_service
from app.api.deps import get_current_user
from app.api.deps import get_uow
from app.repositories import UnitOfWork
from app.schemas.onboarding import OnboardingProfileResponse
from app.schemas.onboarding import OnboardingProfileUpdateRequest
from app.services.auth_service import AuthenticatedUser
from app.services.auth_service import AuthError
from app.services.auth_service import AuthService

router = APIRouter(prefix="/v1/onboarding", tags=["onboarding"])


@router.get(
    "/profile",
    response_model=OnboardingProfileResponse,
    status_code=status.HTTP_200_OK,
)
async def get_onboarding_profile(
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> OnboardingProfileResponse:
    """Return onboarding profile for the authenticated user."""
    try:
        profile = auth_service.get_onboarding_profile(user_id=current_user.id)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return OnboardingProfileResponse(
        relationship_mode=profile.get("relationship_mode"),
        user_name=profile.get("display_name"),
        user_age=profile.get("user_age"),
        ex_partner_name=profile.get("ex_partner_name"),
        ex_partner_pronoun=profile.get("ex_partner_pronoun"),
        breakup_time_range=profile.get("breakup_time_range"),
        children_count_category=profile.get("children_count_category"),
        relationship_goal=profile.get("relationship_goal"),
        breakup_initiator=profile.get("breakup_initiator"),
        custody_type=profile.get("custody_type"),
        response_style=profile.get("response_style"),
        country_code=str(profile.get("country_code") or "UY"),
        language_code=str(profile.get("language_code") or "es"),
        onboarding_completed=bool(profile.get("onboarding_completed", False)),
    )


@router.put(
    "/profile",
    response_model=OnboardingProfileResponse,
    status_code=status.HTTP_200_OK,
)
async def update_onboarding_profile(
    payload: OnboardingProfileUpdateRequest,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
    uow: Annotated[UnitOfWork | None, Depends(get_uow)],
) -> OnboardingProfileResponse:
    """Persist onboarding profile and mark onboarding as completed."""
    try:
        profile = auth_service.update_onboarding_profile(
            user_id=current_user.id,
            relationship_mode=payload.relationship_mode,
            user_name=payload.user_name.strip(),
            user_age=payload.user_age,
            ex_partner_name=payload.ex_partner_name.strip(),
            ex_partner_pronoun=payload.ex_partner_pronoun,
            breakup_time_range=payload.breakup_time_range,
            children_count_category=payload.children_count_category,
            relationship_goal=payload.relationship_goal,
            breakup_initiator=payload.breakup_initiator,
            custody_type=payload.custody_type,
            response_style=payload.response_style,
            country_code=payload.country_code.upper(),
            language_code=payload.language_code.lower(),
        )
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    # MVP simplification: one default case per user, created from onboarding data.
    if uow is not None:
        default_case = uow.cases.get_default_for_user(user_id=current_user.id)
        case_title = payload.ex_partner_name.strip() or "Caso principal"
        if default_case is None:
            uow.cases.create(
                user_id=current_user.id,
                title=case_title,
                contact_name=payload.ex_partner_name.strip() or None,
                relationship_label=payload.relationship_mode,
                summary="",
                contact_id=None,
            )
        else:
            uow.cases.update(
                user_id=current_user.id,
                case_id=UUID(str(default_case["id"])),
                title=case_title,
                contact_name=payload.ex_partner_name.strip() or None,
                relationship_label=payload.relationship_mode,
                summary=None,
                contact_id=None,
            )

    return OnboardingProfileResponse(
        relationship_mode=profile.get("relationship_mode"),
        user_name=profile.get("display_name"),
        user_age=profile.get("user_age"),
        ex_partner_name=profile.get("ex_partner_name"),
        ex_partner_pronoun=profile.get("ex_partner_pronoun"),
        breakup_time_range=profile.get("breakup_time_range"),
        children_count_category=profile.get("children_count_category"),
        relationship_goal=profile.get("relationship_goal"),
        breakup_initiator=profile.get("breakup_initiator"),
        custody_type=profile.get("custody_type"),
        response_style=profile.get("response_style"),
        country_code=str(profile.get("country_code") or "UY"),
        language_code=str(profile.get("language_code") or "es"),
        onboarding_completed=bool(profile.get("onboarding_completed", False)),
    )
