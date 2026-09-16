import uuid

from app.memory.working import CONSOLIDATION_INTERVAL_TURNS
from app.routers import chat as chat_module

# ---------------------------------------------------------------------------
# chat.py's _maybe_enqueue_consolidation: the router-level trigger for app/jobs/
# consolidate.py's consolidate_session (Tier 1 -> Tier 2 compaction, ROADMAP.md).
# Fires once every CONSOLIDATION_INTERVAL_TURNS turns (turns_since_consolidation,
# maintained by app/memory/working.py's append_turn), resetting the counter itself
# right at enqueue time. These tests are DB/Redis-independent: they operate on plain
# bundle dicts and a faked arq pool, exercising only the trigger's own decision
# boundary -- real turn counting against a real Redis-backed bundle is covered by
# test_memory_working.py, and the full live path (real WS conversation -> real
# consolidate_session run -> real profile_facts rows) is covered by the live
# verification in ROADMAP.md.
# ---------------------------------------------------------------------------


class _FakePool:
    def __init__(self):
        self.enqueued: list[tuple] = []

    async def enqueue_job(self, name, *args):
        self.enqueued.append((name, *args))


def _bundle(turns_since_consolidation: int) -> dict:
    return {
        "turns": [],
        "profile_facts": [],
        "retrieved_chunks": [],
        "turns_since_consolidation": turns_since_consolidation,
    }


async def _fake_pool_coro(pool):
    return pool


async def test_enqueues_exactly_when_the_counter_reaches_the_interval(monkeypatch):
    fake_pool = _FakePool()
    monkeypatch.setattr(chat_module, "get_arq_pool", lambda: _fake_pool_coro(fake_pool))

    reset_calls: list[str] = []

    async def fake_mark_consolidated(session_id: str) -> None:
        reset_calls.append(session_id)

    monkeypatch.setattr(chat_module, "mark_consolidated", fake_mark_consolidated)

    session_id = uuid.uuid4()
    bundle = _bundle(CONSOLIDATION_INTERVAL_TURNS)

    await chat_module._maybe_enqueue_consolidation(bundle, session_id)

    assert fake_pool.enqueued == [("consolidate_session", str(session_id))]
    assert reset_calls == [str(session_id)]


async def test_does_not_enqueue_below_the_interval(monkeypatch):
    fake_pool = _FakePool()
    monkeypatch.setattr(chat_module, "get_arq_pool", lambda: _fake_pool_coro(fake_pool))
    monkeypatch.setattr(chat_module, "mark_consolidated", _unexpected_mark_consolidated)

    bundle = _bundle(CONSOLIDATION_INTERVAL_TURNS - 1)
    await chat_module._maybe_enqueue_consolidation(bundle, uuid.uuid4())

    assert fake_pool.enqueued == []


async def test_does_not_enqueue_again_right_after_firing_once_the_counter_is_reset(monkeypatch):
    """Proves the interval is genuinely periodic, not a one-time latch: after firing at
    the threshold and the counter resetting to 0 (what mark_consolidated does for
    real), a bundle at 0 must not immediately fire again."""
    fake_pool = _FakePool()
    monkeypatch.setattr(chat_module, "get_arq_pool", lambda: _fake_pool_coro(fake_pool))
    monkeypatch.setattr(chat_module, "mark_consolidated", _unexpected_mark_consolidated)

    bundle = _bundle(0)
    await chat_module._maybe_enqueue_consolidation(bundle, uuid.uuid4())

    assert fake_pool.enqueued == []


async def test_fires_again_after_another_full_interval(monkeypatch):
    """The "every N additional turns" half of the design, not just the first-fill
    trigger -- 2x the interval must fire too, not just exactly 1x."""
    fake_pool = _FakePool()
    monkeypatch.setattr(chat_module, "get_arq_pool", lambda: _fake_pool_coro(fake_pool))

    async def fake_mark_consolidated(session_id: str) -> None:
        pass

    monkeypatch.setattr(chat_module, "mark_consolidated", fake_mark_consolidated)

    session_id = uuid.uuid4()
    bundle = _bundle(2 * CONSOLIDATION_INTERVAL_TURNS)

    await chat_module._maybe_enqueue_consolidation(bundle, session_id)

    assert fake_pool.enqueued == [("consolidate_session", str(session_id))]


async def _unexpected_mark_consolidated(session_id: str) -> None:
    raise AssertionError("mark_consolidated must never be called when the trigger doesn't fire")
