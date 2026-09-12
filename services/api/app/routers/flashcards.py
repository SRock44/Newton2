import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.db.models import Document, Flashcard
from app.services.flashcards import generate_flashcards, get_due_flashcards, review_flashcard
from app.services.users import get_or_create_user

router = APIRouter(prefix="/flashcards", tags=["flashcards"])


def _serialize(card: Flashcard) -> dict:
    return {
        "id": str(card.id),
        "document_id": str(card.document_id) if card.document_id else None,
        "front": card.front,
        "back": card.back,
        "due": card.due.isoformat(),
        "state": card.fsrs_state,
        "last_review": card.last_review.isoformat() if card.last_review else None,
        "created_at": card.created_at.isoformat(),
    }


@router.post("/generate/{document_id}")
async def generate(
    document_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    document = await db.get(Document, document_id)
    if document is None or document.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    cards = await generate_flashcards(db, user.id, document)
    await db.commit()
    return [_serialize(c) for c in cards]


@router.get("")
async def list_flashcards(
    due_only: bool = Query(False),
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    if due_only:
        cards = await get_due_flashcards(db, user.id)
        return [_serialize(c) for c in cards]

    rows = (
        (
            await db.execute(
                select(Flashcard).where(Flashcard.user_id == user.id).order_by(Flashcard.due)
            )
        )
        .scalars()
        .all()
    )
    return [_serialize(c) for c in rows]


class ReviewRequest(BaseModel):
    rating: int = Field(ge=1, le=4)  # 1=Again, 2=Hard, 3=Good, 4=Easy


@router.post("/{card_id}/review")
async def review(
    card_id: uuid.UUID,
    body: ReviewRequest,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    card = await db.get(Flashcard, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flashcard not found")

    updated = await review_flashcard(db, card, body.rating)
    await db.commit()
    return _serialize(updated)


@router.delete("/{card_id}")
async def delete_flashcard(
    card_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    card = await db.get(Flashcard, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flashcard not found")

    await db.delete(card)
    await db.commit()
    return {"status": "deleted"}
