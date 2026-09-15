import asyncio
from functools import lru_cache

from fastembed import TextEmbedding

from app.core.config import get_settings

MODEL_NAME = "BAAI/bge-small-en-v1.5"  # 384-dim, CPU-friendly, no API key needed


@lru_cache
def _get_embedder() -> TextEmbedding:
    return TextEmbedding(model_name=MODEL_NAME, cache_dir=get_settings().embed_cache_dir)


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
