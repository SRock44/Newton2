import asyncio
import uuid

from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings
from app.core.object_storage import ensure_bucket_sync, get_object_sync, put_object_sync
from app.core.redis_client import get_redis

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10MB
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

# An attached image only ever needs to live long enough for the Vision tool to read it
# during the same conversation -- not a persistent gallery (unlike Documents), so no DB
# row/lifecycle for it, just a short-lived MinIO object plus a Redis pointer scoped to
# the exact chat session it was uploaded into.
IMAGE_TTL_SECONDS = 2 * 60 * 60


def _image_key(session_id: str, image_id: str) -> str:
    return f"newton:session:{session_id}:image:{image_id}"


async def upload_image(user_id: uuid.UUID, session_id: str, file: UploadFile) -> str:
    """Stores the image in MinIO and returns an image_id the frontend can reference in a
    chat message (see app/tools/vision.py) -- scoped to this session via a Redis pointer,
    so the Vision tool can't be tricked into reading a different user's/session's image
    by an id it happened to guess."""
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported image type — use {', '.join(sorted(ALLOWED_MIME_TYPES))}",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image is empty")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Image too large — max {MAX_IMAGE_BYTES // (1024 * 1024)}MB"
        )

    settings = get_settings()
    image_id = str(uuid.uuid4())
    minio_key = f"{user_id}/chat-images/{session_id}/{image_id}"

    await asyncio.to_thread(ensure_bucket_sync, settings.minio_bucket)
    await asyncio.to_thread(put_object_sync, settings.minio_bucket, minio_key, raw, file.content_type)

    await get_redis().set(
        _image_key(session_id, image_id),
        f"{settings.minio_bucket}|{minio_key}|{file.content_type}",
        ex=IMAGE_TTL_SECONDS,
    )
    return image_id


async def get_image_for_session(session_id: str, image_id: str) -> tuple[bytes, str] | None:
    """Returns (raw_bytes, mime_type), or None if this image_id isn't a live attachment
    on this session — either it was never uploaded here, or its TTL expired."""
    raw_pointer = await get_redis().get(_image_key(session_id, image_id))
    if raw_pointer is None:
        return None
    bucket, minio_key, mime_type = raw_pointer.split("|", 2)
    data = await asyncio.to_thread(get_object_sync, bucket, minio_key)
    return data, mime_type
