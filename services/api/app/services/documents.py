import asyncio
import io
import uuid

from fastapi import HTTPException, UploadFile, status
from pypdf import PdfReader
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.object_storage import (
    ensure_bucket_sync,
    get_object_sync,
    put_object_sync,
    remove_object_sync,
)
from app.db.models import Document, DocumentChunk
from app.memory.rag import store_document_chunks

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB

_TEXT_MIME_TYPES = {"text/plain", "text/markdown"}
_TEXT_EXTENSIONS = (".txt", ".md", ".markdown")
_PDF_EXTENSION = ".pdf"


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
    await asyncio.to_thread(ensure_bucket_sync, settings.minio_bucket)
    await asyncio.to_thread(put_object_sync, settings.minio_bucket, minio_key, raw, file.content_type)

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
    raw = await asyncio.to_thread(get_object_sync, settings.minio_bucket, document.minio_key)
    return await asyncio.to_thread(_extract_text, document.filename, document.mime_type, raw)


async def delete_document(db: AsyncSession, document: Document) -> None:
    """Removes a document's chunks and DB row, then its raw object in MinIO."""
    settings = get_settings()
    await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document.id))
    await db.delete(document)
    await db.commit()
    try:
        await asyncio.to_thread(remove_object_sync, settings.minio_bucket, document.minio_key)
    except Exception:
        # The DB rows are the source of truth for what the user sees; don't fail the
        # request over a MinIO object that's already gone or unreachable.
        pass
