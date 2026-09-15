import asyncio
import time
import uuid

from app.routers import chat as chat_module

# ---------------------------------------------------------------------------
# chat.py's _gather_memory_context fires the Tier 3 profile-facts read and the
# document-RAG chunks read concurrently (asyncio.gather) instead of sequentially,
# since they're independent reads that each pay their own embed_text() cost. These
# tests are DB-independent: SessionLocal, retrieve_relevant_facts, and
# retrieve_relevant_chunks are all faked, so this exercises only the concurrency
# shape (and that results come back correctly attributed), not real persistence --
# that's already covered by test_memory_profile.py and test_documents.py.
# ---------------------------------------------------------------------------


class _FakeDBContext:
    """Stands in for `async with SessionLocal() as db:` without touching a real
    engine/connection."""

    async def __aenter__(self):
        return "fake-db-session"

    async def __aexit__(self, exc_type, exc, tb):
        return False


async def test_gather_memory_context_returns_correct_facts_and_chunks(monkeypatch):
    seen_calls: list[tuple[str, object, str]] = []

    async def fake_retrieve_relevant_facts(db, user_id, query):
        seen_calls.append(("facts", user_id, query))
        return ["fact-a", "fact-b"]

    async def fake_retrieve_relevant_chunks(db, user_id, query):
        seen_calls.append(("chunks", user_id, query))
        return ["chunk-a"]

    monkeypatch.setattr(chat_module, "SessionLocal", lambda: _FakeDBContext())
    monkeypatch.setattr(chat_module.profile_memory, "retrieve_relevant_facts", fake_retrieve_relevant_facts)
    monkeypatch.setattr(chat_module.rag_memory, "retrieve_relevant_chunks", fake_retrieve_relevant_chunks)

    user_id = uuid.uuid4()
    facts, chunks = await chat_module._gather_memory_context(user_id, "what is a derivative?")

    assert facts == ["fact-a", "fact-b"]
    assert chunks == ["chunk-a"]
    assert ("facts", user_id, "what is a derivative?") in seen_calls
    assert ("chunks", user_id, "what is a derivative?") in seen_calls


async def test_gather_memory_context_runs_facts_and_chunks_concurrently(monkeypatch):
    """The actual perf fix this proves: two slow retrievals (each standing in for a
    real embed_text() call) fired together take roughly one delay's worth of wall
    time, not the sum of both -- previously they were sequential `await`s."""
    DELAY = 0.15

    async def slow_facts(db, user_id, query):
        await asyncio.sleep(DELAY)
        return ["fact"]

    async def slow_chunks(db, user_id, query):
        await asyncio.sleep(DELAY)
        return ["chunk"]

    monkeypatch.setattr(chat_module, "SessionLocal", lambda: _FakeDBContext())
    monkeypatch.setattr(chat_module.profile_memory, "retrieve_relevant_facts", slow_facts)
    monkeypatch.setattr(chat_module.rag_memory, "retrieve_relevant_chunks", slow_chunks)

    start = time.monotonic()
    facts, chunks = await chat_module._gather_memory_context(uuid.uuid4(), "hi")
    elapsed = time.monotonic() - start

    assert facts == ["fact"]
    assert chunks == ["chunk"]
    assert elapsed < DELAY * 1.8, f"expected concurrent ~{DELAY}s, took {elapsed}s (looks sequential)"


async def test_gather_memory_context_uses_a_separate_session_per_retrieval(monkeypatch):
    """AsyncSession forbids concurrent use by two coroutines at once -- proves each
    retrieval really does get its own SessionLocal() context rather than sharing one,
    which is what makes the concurrent gather() above safe."""
    opened_sessions: list[object] = []

    class _TrackedFakeDBContext(_FakeDBContext):
        async def __aenter__(self):
            db = await super().__aenter__()
            opened_sessions.append(object())
            return db

    async def fake_facts(db, user_id, query):
        return []

    async def fake_chunks(db, user_id, query):
        return []

    monkeypatch.setattr(chat_module, "SessionLocal", lambda: _TrackedFakeDBContext())
    monkeypatch.setattr(chat_module.profile_memory, "retrieve_relevant_facts", fake_facts)
    monkeypatch.setattr(chat_module.rag_memory, "retrieve_relevant_chunks", fake_chunks)

    await chat_module._gather_memory_context(uuid.uuid4(), "hi")

    assert len(opened_sessions) == 2
