import asyncio
import threading

from fastembed import TextEmbedding

from app.core.config import get_settings

MODEL_NAME = "BAAI/bge-small-en-v1.5"  # 384-dim, CPU-friendly, no API key needed

_embedder: TextEmbedding | None = None
# Guards first-time construction of the shared embedder below. Each embed_text() call
# now runs on its own asyncio.to_thread worker thread, and chat.py's
# _gather_memory_context fires two of them concurrently -- so the very first embed of
# the process can have two different threads both see `_embedder is None` and race to
# construct TextEmbedding() at the same time. That's not just wasteful (two model
# loads/downloads instead of one): fastembed's first-run download path uses tqdm
# progress bars, and tqdm's own global lock has a real bug under exactly this kind of
# concurrent-first-use -- reproduced live in CI as `AttributeError: type object 'tqdm'
# has no attribute '_lock'`. A plain functools.lru_cache does NOT prevent this (it
# doesn't stop two threads from both calling the wrapped function concurrently on a
# cache miss); the double-checked lock below does.
_embedder_lock = threading.Lock()


def _get_embedder() -> TextEmbedding:
    global _embedder
    if _embedder is None:
        with _embedder_lock:
            if _embedder is None:  # re-check: another thread may have won the race
                _embedder = TextEmbedding(model_name=MODEL_NAME, cache_dir=get_settings().embed_cache_dir)
    return _embedder


def _embed_sync(text: str) -> list[float]:
    embedder = _get_embedder()
    return next(embedder.embed([text])).tolist()


async def embed_text(text: str) -> list[float]:
    """Embeds one string with the shared fastembed model.

    fastembed's ONNX inference is genuine synchronous CPU work with no async API of
    its own. Calling it directly inside an async def used to run that inference inline
    on the event loop -- blocking every other coroutine (every other connected
    student's WebSocket included) for the duration of each embed. asyncio.to_thread
    moves the actual inference onto a worker thread so the event loop stays free to
    make progress on other work while this awaits."""
    return await asyncio.to_thread(_embed_sync, text)
