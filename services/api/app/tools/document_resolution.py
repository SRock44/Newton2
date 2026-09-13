import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document


async def resolve_document(db: AsyncSession, user_id: uuid.UUID, filename_hint: str | None) -> Document | None:
    """Shared by every generation tool (flashcards, practice exams, study plan, the
    composite study session) that needs to pick "which of the student's uploaded
    documents" from an optional filename hint the model extracted from the chat
    message — defaults to their most recently uploaded document when no hint matches
    or none was given."""
    stmt = select(Document).where(Document.user_id == user_id)
    if filename_hint:
        stmt = stmt.where(Document.filename.ilike(f"%{filename_hint}%"))
    stmt = stmt.order_by(Document.created_at.desc()).limit(1)
    return (await db.execute(stmt)).scalars().first()
