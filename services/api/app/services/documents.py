import asyncio
import io
import uuid
from functools import lru_cache

from fastapi import HTTPException, UploadFile, status
from minio import Minio
from pypdf import PdfReader
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import Document, DocumentChunk
from app.memory.rag import store_document_chunks

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB

_TEXT_MIME_TYPES = {"text/plain", "text/markdown"}
_TEXT_EXTENSIONS = (".txt", ".md", ".markdown")
_PDF_EXTENSION = ".pdf"


@lru_cache
def _get_minio_client() -> Minio:
    settings = get_settings()
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key.get_secret_value(),
        secure=settings.minio_secure,
    )


def _ensure_bucket_sync(bucket: str) -> None:
    client = _get_minio_client()
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)


def _put_object_sync(bucket: str, key: str, data: bytes, content_type: str | None) -> None:
    client = _get_minio_client()
    client.put_object(
        bucket,
        key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type or "application/octet-stream",
    )


def _remove_object_sync(bucket: str, key: str) -> None:
    _get_minio_client().remove_object(bucket, key)


def _get_object_sync(bucket: str, key: str) -> bytes:
    response = _get_minio_client().get_object(bucket, key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def _extract_pdf_text(raw: bytes) -> str:
    reader = PdfReader(io.BytesIO(raw))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_text(filename: str, mime_type: str | None, raw: bytes) -> str:
    """Runs in a worker thread (see upload_document) since PDF parsing is CPU-bound and
    would otherwise block the event loop."""
    lower_name = filename.lower()
    if lower_name.endswith(_PDF_EXTENSION) or mime_type == "application/pdf":
        return _extract_pdf_text(raw)
    if lower_name.endswith(_TEXT_EXTENSIONS) or mime_type in _TEXT_MIME_TYPES:
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is not valid UTF-8 text") from exc
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST, "Unsupported file type — upload .txt, .md, or .pdf"
    )


async def upload_document(db: AsyncSession, user_id: uuid.UUID, file: UploadFile) -> Document:
    """Validate the upload, store the raw bytes in MinIO under a per-user key, create the
    Document row, then run the chunk+embed+store pipeline (app.memory.rag) over the
    extracted text."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is empty")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File too large — max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB",
        )

    filename = file.filename or "upload"
    text = await asyncio.to_thread(_extract_text, filename, file.content_type, raw)

    settings = get_settings()
    document_id = uuid.uuid4()
    minio_key = f"{user_id}/{document_id}/{filename}"

    # MinIO's SDK is synchronous; run its blocking network calls off the event loop.
    await asyncio.to_thread(_ensure_bucket_sync, settings.minio_bucket)
    await asyncio.to_thread(_put_object_sync, settings.minio_bucket, minio_key, raw, file.content_type)

    document = Document(
        id=document_id,
        user_id=user_id,
        filename=filename,
        mime_type=file.content_type,
        minio_key=minio_key,
    )
    db.add(document)
    await db.flush()

    await store_document_chunks(db, document.id, text)
    await db.commit()
    return document


async def get_document_text(document: Document) -> str:
    """Re-fetches the raw file from MinIO and re-runs extraction, rather than storing
    the full text separately from the (overlapping, chunked) RAG copy — documents here
    are small enough that re-extracting on demand is cheap, and it avoids keeping two
    representations of the same content in sync."""
    settings = get_settings()
    raw = await asyncio.to_thread(_get_object_sync, settings.minio_bucket, document.minio_key)
    return await asyncio.to_thread(_extract_text, document.filename, document.mime_type, raw)


async def delete_document(db: AsyncSession, document: Document) -> None:
    """Removes a document's chunks and DB row, then its raw object in MinIO."""
    settings = get_settings()
    await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document.id))
    await db.delete(document)
    await db.commit()
    try:
        await asyncio.to_thread(_remove_object_sync, settings.minio_bucket, document.minio_key)
    except Exception:
        # The DB rows are the source of truth for what the user sees; don't fail the
        # request over a MinIO object that's already gone or unreachable.
        pass
