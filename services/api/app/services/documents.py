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


async def _store_document(
    db: AsyncSession,
    user_id: uuid.UUID,
    filename: str,
    mime_type: str | None,
    raw: bytes,
    text: str,
) -> Document:
    """Shared tail end of both upload_document() and upload_document_bytes(): store the
    raw bytes in MinIO under a per-user key, create the Document row, then run the
    chunk+embed+store pipeline (app.memory.rag) over the already-extracted text."""
    settings = get_settings()
    document_id = uuid.uuid4()
    minio_key = f"{user_id}/{document_id}/{filename}"

    # MinIO's SDK is synchronous; run its blocking network calls off the event loop.
    await asyncio.to_thread(ensure_bucket_sync, settings.minio_bucket)
    await asyncio.to_thread(put_object_sync, settings.minio_bucket, minio_key, raw, mime_type)

    document = Document(
        id=document_id,
        user_id=user_id,
        filename=filename,
        mime_type=mime_type,
        minio_key=minio_key,
    )
    db.add(document)
    await db.flush()

    await store_document_chunks(db, document.id, text)
    await db.commit()
    return document


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
    return await _store_document(db, user_id, filename, file.content_type, raw, text)


async def upload_document_bytes(
    db: AsyncSession,
    user_id: uuid.UUID,
    filename: str,
    mime_type: str,
    raw: bytes,
) -> Document:
    """Bytes-based sibling of upload_document() for content that never arrived as an
    HTTP UploadFile -- e.g. app/tools/write_research_paper.py's compiled PDF and
    generated .tex source, which exist only as in-memory bytes this process produced
    itself. Runs the exact same _extract_text() dispatch upload_document() uses (by
    filename/mime_type), so a generated PDF here is pypdf-extracted for RAG exactly like
    a student-uploaded PDF would be, and a generated .tex file (mime_type="text/plain")
    is stored as plain decoded text -- which for a .tex source IS the document's own
    content, no separate extraction step needed. No MAX_UPLOAD_BYTES check here: this
    content wasn't submitted by an HTTP client and is already bounded well under that
    ceiling by sandbox-runner's own LATEX_MAX_PDF_BYTES."""
    text = await asyncio.to_thread(_extract_text, filename, mime_type, raw)
    return await _store_document(db, user_id, filename, mime_type, raw, text)


async def get_document_text(document: Document) -> str:
    """Re-fetches the raw file from MinIO and re-runs extraction, rather than storing
    the full text separately from the (overlapping, chunked) RAG copy — documents here
    are small enough that re-extracting on demand is cheap, and it avoids keeping two
    representations of the same content in sync."""
    settings = get_settings()
    raw = await asyncio.to_thread(get_object_sync, settings.minio_bucket, document.minio_key)
    return await asyncio.to_thread(_extract_text, document.filename, document.mime_type, raw)


async def get_document_raw(document: Document) -> bytes:
    """Returns the exact bytes stored in MinIO for this document, with no text
    extraction — used to serve the raw file (e.g. embedding a PDF viewer)."""
    settings = get_settings()
    return await asyncio.to_thread(get_object_sync, settings.minio_bucket, document.minio_key)


def is_editable(document: Document) -> bool:
    """True only for plain text/markdown documents — PDFs are view-only since editing
    extracted PDF text and writing it back as a PDF isn't attempted (see the module
    docstring-level rationale in the router)."""
    lower_name = document.filename.lower()
    if lower_name.endswith(_PDF_EXTENSION) or document.mime_type == "application/pdf":
        return False
    return lower_name.endswith(_TEXT_EXTENSIONS) or document.mime_type in _TEXT_MIME_TYPES


async def update_document_content(db: AsyncSession, document: Document, content: str) -> Document:
    """Overwrites the stored file with edited text and re-chunks it for RAG, so
    retrieval always reflects exactly what the student sees and last edited."""
    settings = get_settings()
    raw = content.encode("utf-8")
    await asyncio.to_thread(
        put_object_sync, settings.minio_bucket, document.minio_key, raw, document.mime_type
    )
    await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document.id))
    await store_document_chunks(db, document.id, content)
    await db.commit()
    await db.refresh(document)
    return document


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
