from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, bool]:
    """Healthcheck endpoint used by frontend and deployment probes."""
    return {"ok": True}
