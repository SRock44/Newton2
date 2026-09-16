import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import delete

from app.db.models import ChatMessage, ChatSession, User
from app.memory import working

# ---------------------------------------------------------------------------
# app/memory/working.py: Tier-1 working-memory bundle, plus the turns_since_
# consolidation counter/should_consolidate/mark_consolidated trio that drives the
# Tier-2 compaction trigger (ROADMAP.md). Runs against the real Redis this test
# environment already provides (same one the live WebSocket suite exercises) --
# these are real get_bundle/append_turn calls, not a faked cache.
# ---------------------------------------------------------------------------


def _session_id() -> str:
    return str(uuid.uuid4())


async def test_append_turn_increments_turns_since_consolidation_every_call():
    session_id = _session_id()
    try:
        bundle = await working.append_turn(session_id, "user", "hello")
        assert bundle["turns_since_consolidation"] == 1
        bundle = await working.append_turn(session_id, "assistant", "hi there")
        assert bundle["turns_since_consolidation"] == 2
    finally:
        await working.invalidate(session_id)


async def test_turns_since_consolidation_keeps_counting_past_max_turns_even_though_the_raw_window_is_capped():
    """The raw `turns` list is capped at MAX_TURNS (a plain sliding window), but the
    counter should_consolidate reads must NOT be capped the same way -- otherwise it
    would just permanently read MAX_TURNS forever after the window first fills and
    never signal "another full interval has passed"."""
    session_id = _session_id()
    try:
        bundle = {}
        for i in range(working.MAX_TURNS + 5):
            bundle = await working.append_turn(session_id, "user", f"turn {i}")
        assert len(bundle["turns"]) == working.MAX_TURNS
        assert bundle["turns_since_consolidation"] == working.MAX_TURNS + 5
    finally:
        await working.invalidate(session_id)


async def test_should_consolidate_false_below_threshold_true_at_and_above_it():
    assert working.should_consolidate({"turns_since_consolidation": working.CONSOLIDATION_INTERVAL_TURNS - 1}) is False
    assert working.should_consolidate({"turns_since_consolidation": working.CONSOLIDATION_INTERVAL_TURNS}) is True
    assert working.should_consolidate({"turns_since_consolidation": working.CONSOLIDATION_INTERVAL_TURNS + 1}) is True


async def test_should_consolidate_treats_a_missing_counter_as_zero():
    """A brand-new bundle (or one from before this field existed) must never be
    mistaken for "already due" -- get_bundle's own default dict has no such key."""
    assert working.should_consolidate({}) is False


async def test_mark_consolidated_resets_the_counter_to_zero():
    session_id = _session_id()
    try:
        for _ in range(working.CONSOLIDATION_INTERVAL_TURNS):
            await working.append_turn(session_id, "user", "hi")
        bundle = await working.get_bundle(session_id)
        assert working.should_consolidate(bundle) is True

        await working.mark_consolidated(session_id)

        bundle = await working.get_bundle(session_id)
        assert bundle["turns_since_consolidation"] == 0
        assert working.should_consolidate(bundle) is False
    finally:
        await working.invalidate(session_id)


async def test_mark_consolidated_does_not_touch_the_raw_turns_window():
    """Resetting the counter is a distinct concern from the raw conversation turns --
    mark_consolidated must never drop them (that would silently erase the model's
    recent-conversation context mid-session; see consolidate.py's own comment on why
    it stopped calling the old blanket invalidate() for this exact reason)."""
    session_id = _session_id()
    try:
        await working.append_turn(session_id, "user", "what is a derivative?")
        await working.append_turn(session_id, "assistant", "the rate of change of a function")

        await working.mark_consolidated(session_id)

        bundle = await working.get_bundle(session_id)
        assert bundle["turns"] == [
            {"role": "user", "content": "what is a derivative?"},
            {"role": "assistant", "content": "the rate of change of a function"},
        ]
    finally:
        await working.invalidate(session_id)


# ---------------------------------------------------------------------------
# get_bundle's Postgres rehydration on a cold Redis cache (the real, confirmed bug
# this fix closes -- see ROADMAP.md): a student returning to an existing chat after
# more than BUNDLE_TTL_SECONDS/2 hours idle used to get a Tutor with zero memory of
# that conversation even though the full transcript was sitting in Postgres the whole
# time. These use a real ChatSession/ChatMessage pair (real Postgres), not a fake --
# consistent with tests/test_jobs_consolidate.py's throwaway_session pattern.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_session(db_session):
    user = User(keycloak_sub=f"test-working-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    session = ChatSession(user_id=user.id)
    db_session.add(session)
    await db_session.commit()

    yield session

    await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
    await db_session.execute(delete(ChatSession).where(ChatSession.id == session.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()
    await working.invalidate(str(session.id))


def _at(seconds_ago: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)


async def test_cold_bundle_rehydrates_from_postgres_when_session_has_prior_history(
    db_session, throwaway_session
):
    session = throwaway_session
    # Oldest first, explicit created_at so ordering doesn't depend on same-transaction
    # timestamp resolution (Postgres' now() is constant within one transaction).
    db_session.add_all(
        [
            ChatMessage(session_id=session.id, role="user", content="hi", created_at=_at(2)),
            ChatMessage(session_id=session.id, role="assistant", content="hello", created_at=_at(1)),
        ]
    )
    await db_session.commit()

    # Confirm the cache is genuinely cold (nothing in Redis for this session yet --
    # append_turn/get_bundle were never called for it).
    bundle = await working.get_bundle(str(session.id))

    assert bundle["turns"] == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]
    assert bundle["turns_since_consolidation"] == 0
    assert bundle["profile_facts"] == []
    assert bundle["retrieved_chunks"] == []


async def test_cold_bundle_rehydration_only_returns_the_most_recent_max_turns_window(
    db_session, throwaway_session
):
    """More than MAX_TURNS messages exist -- only the most recent window comes back,
    oldest-of-the-window first, matching the order append_turn already builds up
    incrementally (run_tutor iterates bundle["turns"] in order)."""
    session = throwaway_session
    total = working.MAX_TURNS + 5
    # created_at descends into the past as i increases, so message 0 is newest.
    db_session.add_all(
        [
            ChatMessage(
                session_id=session.id,
                role="user" if i % 2 == 0 else "assistant",
                content=f"turn {i}",
                created_at=_at(total - i),
            )
            for i in range(total)
        ]
    )
    await db_session.commit()

    bundle = await working.get_bundle(str(session.id))

    assert len(bundle["turns"]) == working.MAX_TURNS
    # The oldest 5 turns (0-4) aged out; turns 5..total-1 remain, oldest-first.
    expected_contents = [f"turn {i}" for i in range(5, total)]
    assert [t["content"] for t in bundle["turns"]] == expected_contents


async def test_cold_bundle_for_genuinely_new_session_still_returns_empty(db_session):
    """No ChatSession/ChatMessage rows exist at all for this session id -- must behave
    exactly as before this fix: the plain empty default, and no Redis write (so a
    second call still finds a cold cache, not a wrongly-persisted empty bundle)."""
    session_id = str(uuid.uuid4())

    bundle = await working.get_bundle(session_id)

    assert bundle == {"turns": [], "profile_facts": [], "retrieved_chunks": [], "updated_at": None}

    from app.core.redis_client import get_redis

    raw = await get_redis().get(working._bundle_key(session_id))
    assert raw is None, "a genuinely empty session must not get a Redis write"


async def test_rehydrated_bundle_is_cached_so_a_second_call_does_not_requery_postgres(
    db_session, throwaway_session, monkeypatch
):
    session = throwaway_session
    db_session.add(ChatMessage(session_id=session.id, role="user", content="my favorite color is blue"))
    await db_session.commit()

    calls: list[str] = []
    original = working._rehydrate_from_postgres

    async def _spy(session_id: str):
        calls.append(session_id)
        return await original(session_id)

    monkeypatch.setattr(working, "_rehydrate_from_postgres", _spy)

    first = await working.get_bundle(str(session.id))
    assert len(calls) == 1
    assert first["turns"] == [{"role": "user", "content": "my favorite color is blue"}]

    second = await working.get_bundle(str(session.id))
    assert len(calls) == 1, "a warm (just-rehydrated) cache must not trigger a second Postgres query"
    assert second["turns"] == first["turns"]
