import uuid

from app.db.models import ChatSession
from app.routers import chat as chat_module

# ---------------------------------------------------------------------------
# chat.py's _maybe_enqueue_title_job: the router-level trigger for app/jobs/
# titling.py's generate_session_title. Fires exactly once -- at the SECOND assistant
# ChatMessage for a session, and only while session.title is still unset. These tests
# are DB-independent: `db.execute` is faked to return a controllable assistant-reply
# count, so this exercises only the trigger's own decision boundary (when to enqueue),
# not real message counting -- that's implicitly covered by the real WebSocket
# integration tests in test_chat_websocket.py, which run against a real Postgres.
# ---------------------------------------------------------------------------


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _FakeDB:
    def __init__(self, assistant_reply_count: int):
        self._assistant_reply_count = assistant_reply_count
        self.execute_calls = 0

    async def execute(self, _stmt):
        self.execute_calls += 1
        return _FakeScalarResult(self._assistant_reply_count)


class _FakePool:
    def __init__(self):
        self.enqueued: list[tuple] = []

    async def enqueue_job(self, name, *args):
        self.enqueued.append((name, *args))


async def test_enqueues_on_exactly_the_second_assistant_reply(monkeypatch):
    fake_pool = _FakePool()
    monkeypatch.setattr(chat_module, "get_arq_pool", lambda: _fake_pool_coro(fake_pool))

    db = _FakeDB(assistant_reply_count=2)
    session = ChatSession(title=None)
    session_id = uuid.uuid4()

    await chat_module._maybe_enqueue_title_job(db, session, session_id)

    assert fake_pool.enqueued == [("generate_session_title", str(session_id))]


async def test_does_not_enqueue_on_the_first_assistant_reply(monkeypatch):
    fake_pool = _FakePool()
    monkeypatch.setattr(chat_module, "get_arq_pool", lambda: _fake_pool_coro(fake_pool))

    db = _FakeDB(assistant_reply_count=1)
    session = ChatSession(title=None)

    await chat_module._maybe_enqueue_title_job(db, session, uuid.uuid4())

    assert fake_pool.enqueued == []


async def test_does_not_enqueue_on_the_third_or_later_assistant_reply(monkeypatch):
    fake_pool = _FakePool()
    monkeypatch.setattr(chat_module, "get_arq_pool", lambda: _fake_pool_coro(fake_pool))

    db = _FakeDB(assistant_reply_count=3)
    session = ChatSession(title=None)

    await chat_module._maybe_enqueue_title_job(db, session, uuid.uuid4())

    assert fake_pool.enqueued == []


async def test_does_not_enqueue_when_a_title_is_already_set(monkeypatch):
    """Even if this were somehow the 2nd assistant reply, an already-set title means
    the count query should never even run -- belt-and-suspenders with the job's own
    no-op-if-title-set guard, not redundant with it."""
    fake_pool = _FakePool()
    monkeypatch.setattr(chat_module, "get_arq_pool", lambda: _fake_pool_coro(fake_pool))

    db = _FakeDB(assistant_reply_count=2)
    session = ChatSession(title="Already titled")

    await chat_module._maybe_enqueue_title_job(db, session, uuid.uuid4())

    assert fake_pool.enqueued == []
    assert db.execute_calls == 0


async def _fake_pool_coro(pool):
    return pool
