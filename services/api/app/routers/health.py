from fastapi import APIRouter, Depends

from app.core.auth import require_user

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Unauthenticated liveness probe for Docker/orchestrator health checks."""
    return {"status": "ok"}


@router.get("/health/secure")
async def health_secure(claims: dict = Depends(require_user)) -> dict:
    """Authenticated check confirming Keycloak token validation actually works end-to-end."""
    return {"status": "ok", "subject": claims.get("sub")}
