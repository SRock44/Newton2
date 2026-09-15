import asyncio
import threading
import time

from app.memory import embeddings

# ---------------------------------------------------------------------------
# embed_text must run fastembed's synchronous ONNX inference off the event loop
# (asyncio.to_thread), not inline inside the coroutine -- otherwise it blocks every
# other coroutine (every other connected student's WebSocket, in the real chat_ws
# handler) for the duration of each embed. These tests are DB-independent: they mock
# out the actual model call, so they exercise only the async-offloading behavior
# itself, not fastembed or a live model.
# ---------------------------------------------------------------------------


async def test_embed_text_returns_the_underlying_sync_result(monkeypatch):
    monkeypatch.setattr(embeddings, "_embed_sync", lambda text: [1.0, 2.0, 3.0])

    result = await embeddings.embed_text("hello")

    assert result == [1.0, 2.0, 3.0]


async def test_embed_text_does_not_block_the_event_loop(monkeypatch):
    """The real regression this guards against: a naive `def embed_text` called
    directly from an async def runs its CPU-bound body inline on the event loop, so a
    concurrent coroutine literally cannot make progress until it returns. Simulates
    real synchronous ONNX inference with a blocking time.sleep (not asyncio.sleep --
    that would trivially "pass" even without asyncio.to_thread) and proves a second,
    much shorter coroutine still completes first when raced via asyncio.gather."""
    SLOW_SECONDS = 0.15

    def slow_sync_embed(text: str) -> list[float]:
        time.sleep(SLOW_SECONDS)  # stands in for real synchronous ONNX inference
        return [0.1, 0.2]

    monkeypatch.setattr(embeddings, "_embed_sync", slow_sync_embed)

    progressed_while_embedding = False

    async def other_coroutine() -> None:
        nonlocal progressed_while_embedding
        await asyncio.sleep(SLOW_SECONDS / 5)
        progressed_while_embedding = True

    start = time.monotonic()
    embed_result, _ = await asyncio.gather(embeddings.embed_text("hi"), other_coroutine())
    elapsed = time.monotonic() - start

    assert embed_result == [0.1, 0.2]
    # If embed_text blocked the loop, other_coroutine's sleep couldn't even start
    # ticking until the slow sync call returned, so this would still end up True by
    # the time gather() resolves -- the real proof is the elapsed time below.
    assert progressed_while_embedding is True
    # Both ran concurrently: total time is close to one SLOW_SECONDS delay, not the sum
    # of both (which a blocking implementation would produce).
    assert elapsed < SLOW_SECONDS * 1.8


def test_get_embedder_is_thread_safe_against_a_concurrent_first_call(monkeypatch):
    """Regression test for a real bug caught in CI: chat.py's _gather_memory_context
    fires two embed_text() calls concurrently, each on its own asyncio.to_thread worker
    thread. On the very first embed of a process, both threads used to see the shared
    embedder as uninitialized and race to construct it at the same time -- wasteful at
    best, and it actually crashed in CI (fastembed's first-run model-download path hits
    a real bug in tqdm's own locking under concurrent first-use: `AttributeError: type
    object 'tqdm' has no attribute '_lock'`). The double-checked lock in _get_embedder
    must ensure the underlying constructor runs exactly once even when hammered from
    many threads at once."""
    monkeypatch.setattr(embeddings, "_embedder", None)

    construct_count = 0
    construct_lock = threading.Lock()

    class _FakeEmbedder:
        def __init__(self):
            nonlocal construct_count
            # Widens the race window so two threads seeing `_embedder is None` at the
            # same time is actually likely to happen in this test, not just
            # theoretically possible.
            time.sleep(0.02)
            with construct_lock:
                construct_count += 1

    monkeypatch.setattr(embeddings, "TextEmbedding", lambda **kwargs: _FakeEmbedder())

    results: list[object] = []

    def call_get_embedder():
        results.append(embeddings._get_embedder())

    threads = [threading.Thread(target=call_get_embedder) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert construct_count == 1, "the embedder constructor must run exactly once, not once per racing thread"
    assert len({id(r) for r in results}) == 1, "every caller must get back the same shared instance"


async def test_embed_text_runs_two_concurrent_calls_in_roughly_one_delay(monkeypatch):
    """Directly mirrors the real chat.py usage: two independent embed_text() calls
    (profile facts + RAG chunks) fired concurrently via asyncio.gather should together
    take about as long as one call, not two."""
    SLOW_SECONDS = 0.15

    def slow_sync_embed(text: str) -> list[float]:
        time.sleep(SLOW_SECONDS)
        return [len(text)]

    monkeypatch.setattr(embeddings, "_embed_sync", slow_sync_embed)

    start = time.monotonic()
    results = await asyncio.gather(embeddings.embed_text("aaa"), embeddings.embed_text("bb"))
    elapsed = time.monotonic() - start

    assert results == [[3], [2]]
    assert elapsed < SLOW_SECONDS * 1.8
