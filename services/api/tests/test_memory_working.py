import uuid

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
