import os
import uuid

import httpx
import pytest_asyncio
from sqlalchemy import delete

from app.core.config import get_settings
from app.db.base import SessionLocal, engine
from app.db.models import ChatMessage, ChatSession

API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")
KEYCLOAK_USERNAME = "student1"
KEYCLOAK_PASSWORD = "newton-dev"
KEYCLOAK_CLIENT_ID = "newton-api"

# Set by .github/workflows/test.yml (and available to anyone reproducing that CI setup
# locally -- see infra/README.md's "Running the hermetic suite locally" section): when
# truthy, keycloak_token below mints a self-signed JWT instead of doing a real password
# grant against a running Keycloak. Everything else (db_session, http_client, ...)
# is unchanged either way -- see the module docstring in tests/hermetic/tokens.py for
# why only auth needed splitting: get_or_create_user JIT-provisions a User row from
# whatever claims a valid token carries, so the app itself never needs a real Keycloak
# account to exist, only a token its own JWKS-backed verification accepts.
HERMETIC_TESTS = os.environ.get("HERMETIC_TESTS", "").lower() in ("1", "true", "yes")


@pytest_asyncio.fixture
async def keycloak_token() -> str:
    """The bearer token every other auth fixture (auth_headers, and anything deriving
    a user from it, e.g. test_billing.py's student1_user/test_voice_router.py's
    pro_student) builds on.

    Live mode (default, matches the real deployed stack / the manual smoke tests in
    infra/README.md): a real Direct Grant (password) login against the dev realm's
    Keycloak, authenticating as the real student1 account.

    Hermetic mode (HERMETIC_TESTS=1, set by CI): mints a self-signed RS256 JWT with the
    same shape (sub/email/name/preferred_username, matching aud/iss) instead -- no
    network call, no real Keycloak needed. The API process under test still verifies it
    for real, against a fake JWKS server (tests/hermetic/jwks_server.py) CI points
    KEYCLOAK_INTERNAL_URL at, so this is exercising the actual verification code path
    in app/core/auth.py, not bypassing it."""
    settings = get_settings()
    if HERMETIC_TESTS:
        from hermetic.tokens import mint_token

        return mint_token(audience=settings.keycloak_audience, issuer=settings.keycloak_issuer)

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.keycloak_internal_url}/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": KEYCLOAK_CLIENT_ID,
                "username": KEYCLOAK_USERNAME,
                "password": KEYCLOAK_PASSWORD,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


@pytest_asyncio.fixture
async def auth_headers(keycloak_token: str) -> dict:
    return {"Authorization": f"Bearer {keycloak_token}"}


@pytest_asyncio.fixture
async def http_client():
    # Generous on purpose: several endpoints this hits (study plan/flashcard generation,
    # Vision) make a real call to a real LLM, and a tight budget flakes under genuinely
    # real (if slightly slow, especially with several such calls competing for the same
    # upstream API during a full suite run) response times rather than any actual bug.
    async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=45.0) as client:
        yield client


@pytest_asyncio.fixture
async def db_session():
    """Direct DB access for setup/teardown and assertions the REST API doesn't expose."""
    async with SessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def created_session_ids(db_session):
    """Tracks session ids created during a test so we can wipe them (and any messages —
    redundant with migration 0004's ON DELETE CASCADE, but harmless to also do here)
    afterward and not leave junk in the shared dev database."""
    ids: list[uuid.UUID] = []
    yield ids
    for session_id in ids:
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_id))
    await db_session.commit()


@pytest_asyncio.fixture(autouse=True)
async def _dispose_db_engine_after_test():
    """pytest-asyncio gives each test function its own event loop, but app.db.base's
    async engine (and its asyncpg connection pool) is a process-wide singleton created
    once at import time. asyncpg connections are bound to the event loop they were
    created on, so a pooled connection reused in a later test's (different) loop blows
    up with "Event loop is closed" / "attached to a different loop" errors. Disposing
    the pool at the end of every test — while its own loop is still alive — forces the
    next test to open fresh connections on its own loop instead of touching a dead one."""
    yield
    await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def _dispose_redis_client_after_test():
    """Same cross-event-loop hazard as the DB engine above, for the shared module-level
    Redis client singleton (app.core.redis_client): close it and drop the cached
    reference after each test so the next test (its own event loop) opens a fresh
    connection instead of reusing one bound to a now-closed loop."""
    yield
    from app.core.redis_client import reset_redis_client

    await reset_redis_client()
