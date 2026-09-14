import time

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt

from app.core.config import get_settings

bearer_scheme = HTTPBearer(auto_error=False)

_jwks_cache: dict = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL_SECONDS = 300


async def _get_jwks() -> dict:
    settings = get_settings()
    now = time.monotonic()
    if _jwks_cache["keys"] is not None and now - _jwks_cache["fetched_at"] < _JWKS_TTL_SECONDS:
        return _jwks_cache["keys"]

    # Deliberately not using the discovery document's self-reported `jwks_uri`: Keycloak
    # stamps that URL with its own configured KC_HOSTNAME (the browser-facing address),
    # which this container can't necessarily reach -- so hit the well-known certs path
    # directly on the internal address instead.
    async with httpx.AsyncClient(timeout=5.0) as client:
        jwks_response = await client.get(
            f"{settings.keycloak_internal_url}/protocol/openid-connect/certs"
        )
        jwks_response.raise_for_status()
        jwks = jwks_response.json()

    _jwks_cache["keys"] = jwks
    _jwks_cache["fetched_at"] = now
    return jwks


async def decode_token(token: str) -> dict:
    """Verify a raw bearer token against Keycloak's JWKS. Shared by the HTTP dependency
    below and the WebSocket handler, which can't rely on FastAPI's HTTPBearer since
    browsers don't let JS set the Authorization header on a WS handshake."""
    settings = get_settings()
    jwks = await _get_jwks()

    try:
        return jwt.decode(
            token,
            jwks,
            # Pin the accepted signature algorithm explicitly rather than trusting the
            # token's own `alg` header, per RFC 8725 (JWT Best Current Practices) --
            # without this, python-jose lets whoever crafted the token pick how it gets
            # verified (e.g. `alg: none`, or an RS256-to-HS256 confusion attack if the
            # public key is obtainable, which it is here since it's served over JWKS).
            # Keycloak's realm key (infra/keycloak/realm-newton.json) signs every real
            # token with RS256 -- confirmed live against the running instance's own
            # JWKS (`GET /protocol/openid-connect/certs`), whose signing key entry
            # reports `"alg": "RS256"`.
            algorithms=["RS256"],
            audience=settings.keycloak_audience,
            issuer=settings.keycloak_issuer,
        )
    except jwt.JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}") from exc


async def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    return await decode_token(credentials.credentials)
