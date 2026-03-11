from typing import Annotated

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status

from app.api.deps import get_auth_service
from app.api.deps import get_current_user
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
        objective=profile.get("objective"),
        has_children=profile.get("has_children"),
        breakup_side=profile.get("breakup_side"),
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
) -> OnboardingProfileResponse:
    """Persist onboarding profile and mark onboarding as completed."""
    try:
        profile = auth_service.update_onboarding_profile(
            user_id=current_user.id,
            objective=payload.objective.strip(),
            has_children=payload.has_children,
            breakup_side=payload.breakup_side,
            country_code=payload.country_code.upper(),
            language_code=payload.language_code.lower(),
        )
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return OnboardingProfileResponse(
        objective=profile.get("objective"),
        has_children=profile.get("has_children"),
        breakup_side=profile.get("breakup_side"),
        country_code=str(profile.get("country_code") or "UY"),
        language_code=str(profile.get("language_code") or "es"),
        onboarding_completed=bool(profile.get("onboarding_completed", False)),
    )
