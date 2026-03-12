from typing import Annotated
import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import Header
from fastapi import HTTPException
from fastapi import status

from app.api.deps import get_auth_service
from app.schemas.auth import CurrentSessionResponse
from app.schemas.auth import GoogleAuthRequest
from app.schemas.auth import GoogleAuthResponse
from app.schemas.auth import LogoutRequest
from app.schemas.auth import LogoutResponse
from app.schemas.auth import RefreshSessionRequest
from app.schemas.auth import UserSummary
from app.services.auth_service import AuthError
from app.services.auth_service import AuthService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.post(
    "/google",
    response_model=GoogleAuthResponse,
    status_code=status.HTTP_200_OK,
)
async def google_sign_in(
    payload: GoogleAuthRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> GoogleAuthResponse:
    """Validate Google ID token and create/refresh an authenticated session."""
    try:
        tokens, user = auth_service.sign_in_with_google(payload.id_token)
    except AuthError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=exc.detail,
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error in /v1/auth/google: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="auth_internal_error",
        ) from exc

    return GoogleAuthResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        token_type=tokens.token_type,
        expires_in=tokens.expires_in,
        refresh_expires_in=tokens.refresh_expires_in,
        user=UserSummary(
            id=user.id,
            email=user.email,
            name=user.name,
            memory_opt_in=user.memory_opt_in,
            locale=user.locale,
            picture_url=user.picture_url,
            country_code=user.country_code,
            language_code=user.language_code,
            onboarding_completed=user.onboarding_completed,
        ),
    )


@router.post(
    "/refresh",
    response_model=GoogleAuthResponse,
    status_code=status.HTTP_200_OK,
)
async def refresh_session(
    payload: RefreshSessionRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> GoogleAuthResponse:
    """Rotate access/refresh tokens for an active session."""
    try:
        tokens, user = auth_service.refresh_session(payload.refresh_token)
    except AuthError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=exc.detail,
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error in /v1/auth/refresh: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="auth_internal_error",
        ) from exc

    return GoogleAuthResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        token_type=tokens.token_type,
        expires_in=tokens.expires_in,
        refresh_expires_in=tokens.refresh_expires_in,
        user=UserSummary(
            id=user.id,
            email=user.email,
            name=user.name,
            memory_opt_in=user.memory_opt_in,
            locale=user.locale,
            picture_url=user.picture_url,
            country_code=user.country_code,
            language_code=user.language_code,
            onboarding_completed=user.onboarding_completed,
        ),
    )


@router.post(
    "/logout",
    response_model=LogoutResponse,
    status_code=status.HTTP_200_OK,
)
async def logout_session(
    payload: LogoutRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> LogoutResponse:
    """Revoke an active session by refresh token."""
    try:
        revoked = auth_service.logout(payload.refresh_token)
    except AuthError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=exc.detail,
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error in /v1/auth/logout: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="auth_internal_error",
        ) from exc
    return LogoutResponse(revoked=revoked)


@router.get(
    "/me",
    response_model=CurrentSessionResponse,
    status_code=status.HTTP_200_OK,
)
async def current_session(
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> CurrentSessionResponse:
    """Return current user associated with bearer access token."""
    try:
        user = auth_service.get_user_from_access_token(authorization)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except Exception as exc:
        logger.exception("Unexpected error in /v1/auth/me: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="auth_internal_error",
        ) from exc

    return CurrentSessionResponse(
        user=UserSummary(
            id=user.id,
            email=user.email,
            name=user.name,
            memory_opt_in=user.memory_opt_in,
            locale=user.locale,
            picture_url=user.picture_url,
            country_code=user.country_code,
            language_code=user.language_code,
            onboarding_completed=user.onboarding_completed,
        )
    )

