import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.db.models import Document, StudyPlanItem
from app.services.study_planner import generate_study_plan
from app.services.users import get_or_create_user

router = APIRouter(prefix="/study-plan", tags=["study-plan"])


def _serialize(item: StudyPlanItem) -> dict:
    return {
        "id": str(item.id),
        "document_id": str(item.document_id) if item.document_id else None,
        "title": item.title,
        "due_date": item.due_date.isoformat() if item.due_date else None,
        "due_date_text": item.due_date_text,
        "notes": item.notes,
        "source": item.source,
        "created_at": item.created_at.isoformat(),
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

    items = await generate_study_plan(db, user.id, document)
    await db.commit()
    return [_serialize(item) for item in items]


@router.get("")
async def list_plan(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    rows = (
        (
            await db.execute(
                select(StudyPlanItem)
                .where(StudyPlanItem.user_id == user.id)
                .order_by(StudyPlanItem.due_date.is_(None), StudyPlanItem.due_date, StudyPlanItem.created_at)
            )
        )
        .scalars()
        .all()
    )
    return [_serialize(item) for item in rows]


@router.delete("/{item_id}")
async def delete_item(
    item_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    item = await db.get(StudyPlanItem, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study plan item not found")

    await db.delete(item)
    await db.commit()
    return {"status": "deleted"}
