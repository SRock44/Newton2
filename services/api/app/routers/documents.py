import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.db.models import Document
from app.services.documents import (
    delete_document,
    get_document_raw,
    get_document_text,
    is_editable,
    update_document_content,
    upload_document,
)
from app.services.users import get_or_create_user

router = APIRouter(prefix="/documents", tags=["documents"])


class DocumentContentUpdate(BaseModel):
    content: str


class DocumentRename(BaseModel):
    filename: str


def _document_meta(document: Document) -> dict:
    return {
        "id": str(document.id),
        "filename": document.filename,
        "mime_type": document.mime_type,
        "created_at": document.created_at.isoformat(),
    }


async def _get_owned_document(db: AsyncSession, document_id: uuid.UUID, user_id: uuid.UUID) -> Document:
    document = await db.get(Document, document_id)
    if document is None or document.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return document


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    document = await upload_document(db, user.id, file)
    return {
        "id": str(document.id),
        "filename": document.filename,
        "mime_type": document.mime_type,
        "created_at": document.created_at.isoformat(),
    }


@router.get("")
async def list_documents(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    rows = (
        (
            await db.execute(
                select(Document).where(Document.user_id == user.id).order_by(Document.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(d.id),
            "filename": d.filename,
            "mime_type": d.mime_type,
            "created_at": d.created_at.isoformat(),
        }
        for d in rows
    ]


@router.delete("/{document_id}")
async def delete(
    document_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    await delete_document(db, document)
    return {"status": "deleted"}


@router.get("/{document_id}/content")
async def get_content(
    document_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Extracted text for the viewer/editor pane — for a PDF this is the extracted
    text (view-only); `editable` tells the frontend whether to offer an Edit toggle."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    content = await get_document_text(document)
    return {"content": content, "editable": is_editable(document)}


@router.get("/{document_id}/raw")
async def get_raw(
    document_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The exact stored bytes with the original Content-Type — what a PDF viewer embeds
    or a download affordance would fetch. No text extraction here."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    data = await get_document_raw(document)
    return Response(content=data, media_type=document.mime_type or "application/octet-stream")


@router.put("/{document_id}/content")
async def update_content(
    document_id: uuid.UUID,
    body: DocumentContentUpdate,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Overwrites a text/markdown document's stored content and re-chunks it for RAG.
    PDFs are view-only — editing extracted PDF text and writing it back as a PDF would
    just produce garbage, so that's rejected outright."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    if not is_editable(document):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This document type can't be edited — PDFs are view-only")
    document = await update_document_content(db, document, body.content)
    return _document_meta(document)


@router.patch("/{document_id}")
async def rename(
    document_id: uuid.UUID,
    body: DocumentRename,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Renames the display filename only — the MinIO object key is an internal storage
    path and doesn't need to track the display name."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    filename = body.filename.strip()
    if not filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Filename can't be empty")
    document.filename = filename
    await db.commit()
    await db.refresh(document)
    return _document_meta(document)
