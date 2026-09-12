import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.db.models import Document
from app.services.documents import delete_document, upload_document
from app.services.users import get_or_create_user

router = APIRouter(prefix="/documents", tags=["documents"])


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
    document = await db.get(Document, document_id)
    if document is None or document.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    await delete_document(db, document)
    return {"status": "deleted"}
