from functools import lru_cache

from fastembed import TextEmbedding

from app.core.config import get_settings

MODEL_NAME = "BAAI/bge-small-en-v1.5"  # 384-dim, CPU-friendly, no API key needed


@lru_cache
def _get_embedder() -> TextEmbedding:
    return TextEmbedding(model_name=MODEL_NAME, cache_dir=get_settings().embed_cache_dir)


def embed_text(text: str) -> list[float]:
    embedder = _get_embedder()
    return next(embedder.embed([text])).tolist()
