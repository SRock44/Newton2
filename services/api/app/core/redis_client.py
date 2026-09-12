import redis.asyncio as redis

from app.core.config import get_settings

# One shared connection pool for every Redis consumer (working memory, OAuth state,
# image-upload session scoping, ...) rather than each module opening its own — same
# Redis instance either way, no reason for N separate pools to it.
_redis: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


async def reset_redis_client() -> None:
    """Test-only: drops the cached client so the next call opens a fresh connection.
    See tests/conftest.py's _dispose_redis_client_after_test for why this matters."""
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
