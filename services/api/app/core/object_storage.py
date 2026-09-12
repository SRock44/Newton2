import io
from functools import lru_cache

from minio import Minio

from app.core.config import get_settings

# Shared by every MinIO consumer (documents, chat image attachments, ...). All of these
# are blocking network calls (the MinIO SDK is synchronous) -- callers must run them via
# asyncio.to_thread, this module doesn't do that itself so it stays usable from sync code.


@lru_cache
def get_minio_client() -> Minio:
    settings = get_settings()
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key.get_secret_value(),
        secure=settings.minio_secure,
    )


def ensure_bucket_sync(bucket: str) -> None:
    client = get_minio_client()
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)


def put_object_sync(bucket: str, key: str, data: bytes, content_type: str | None) -> None:
    client = get_minio_client()
    client.put_object(
        bucket,
        key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type or "application/octet-stream",
    )


def get_object_sync(bucket: str, key: str) -> bytes:
    response = get_minio_client().get_object(bucket, key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def remove_object_sync(bucket: str, key: str) -> None:
    get_minio_client().remove_object(bucket, key)
