import json
from datetime import datetime, timezone

from app.core.redis_client import get_redis

BUNDLE_TTL_SECONDS = 2 * 60 * 60
MAX_TURNS = 20


def _bundle_key(session_id: str) -> str:
    return f"newton:session:{session_id}:bundle"


async def get_bundle(session_id: str) -> dict:
    """Tier 1: the assembled context bundle for an active session — recent turns plus
    retrieved profile facts and retrieved document chunks, cached in Redis and reused
    across turns instead of being rebuilt from Postgres on every message."""
    raw = await get_redis().get(_bundle_key(session_id))
    if raw:
        return json.loads(raw)
    return {"turns": [], "profile_facts": [], "retrieved_chunks": [], "updated_at": None}


async def _save(session_id: str, bundle: dict) -> None:
    bundle["updated_at"] = datetime.now(timezone.utc).isoformat()
    await get_redis().set(_bundle_key(session_id), json.dumps(bundle), ex=BUNDLE_TTL_SECONDS)


async def append_turn(session_id: str, role: str, content: str) -> dict:
    bundle = await get_bundle(session_id)
    bundle["turns"].append({"role": role, "content": content})
    bundle["turns"] = bundle["turns"][-MAX_TURNS:]
    await _save(session_id, bundle)
    return bundle


async def set_profile_facts(session_id: str, facts: list[str]) -> dict:
    bundle = await get_bundle(session_id)
    bundle["profile_facts"] = facts
    await _save(session_id, bundle)
    return bundle


async def set_retrieved_chunks(session_id: str, chunks: list[str]) -> dict:
    bundle = await get_bundle(session_id)
    bundle["retrieved_chunks"] = chunks
    await _save(session_id, bundle)
    return bundle


async def invalidate(session_id: str) -> None:
    """Called when something underlying changed (session consolidated into new profile
    facts) so the next turn rebuilds the bundle instead of serving stale context."""
    await get_redis().delete(_bundle_key(session_id))
