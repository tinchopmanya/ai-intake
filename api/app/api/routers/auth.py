from uuid import uuid4

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import status

from app.schemas.auth import GoogleAuthRequest
from app.schemas.auth import GoogleAuthResponse
from app.schemas.auth import UserSummary

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.post(
    "/google",
    response_model=GoogleAuthResponse,
    status_code=status.HTTP_200_OK,
)
async def google_sign_in(payload: GoogleAuthRequest) -> GoogleAuthResponse:
    # Base validation guard until Google token verification is wired.
    if len(payload.id_token) < 20:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_google_token",
        )

    return GoogleAuthResponse(
        access_token=f"dev-{uuid4()}",
        token_type="bearer",
        expires_in=3600,
        user=UserSummary(
            id=uuid4(),
            email="user@example.com",
            name="Usuario MVP",
            memory_opt_in=False,
        ),
    )

