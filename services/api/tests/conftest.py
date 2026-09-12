import httpx
import pytest_asyncio

from app.core.config import get_settings
from app.db.base import SessionLocal, engine

API_BASE_URL = "http://localhost:8000"
KEYCLOAK_USERNAME = "student1"
KEYCLOAK_PASSWORD = "newton-dev"
KEYCLOAK_CLIENT_ID = "newton-api"


@pytest_asyncio.fixture
async def keycloak_token() -> str:
    """Password-grant against the dev realm's Keycloak, the same way the project's
    earlier manual smoke tests did (see infra/README.md)."""
    settings = get_settings()
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
    async with httpx.AsyncClient(base_url=API_BASE_URL, timeout=10.0) as client:
        yield client


@pytest_asyncio.fixture
async def db_session():
    """Direct DB access for setup/teardown and assertions the REST API doesn't expose."""
    async with SessionLocal() as session:
        yield session


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
    """Same cross-event-loop hazard as the DB engine above, for the module-level Redis
    client singletons in app.memory.working and app.services.google_classroom: close them
    and drop the cached reference after each test so the next test (its own event loop)
    opens a fresh connection instead of reusing one bound to a now-closed loop."""
    yield
    from app.memory import working as working_memory
    from app.services import google_classroom

    if working_memory._redis is not None:
        await working_memory._redis.aclose()
        working_memory._redis = None
    if google_classroom._redis is not None:
        await google_classroom._redis.aclose()
        google_classroom._redis = None
