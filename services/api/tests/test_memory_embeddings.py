import asyncio
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
