"""Read-only REST surface for app/services/weak_areas.py.

That service already computed real, per-topic weak areas from actual performance data
(FlashcardReviewLog ratings + PracticeExamQuestion.is_correct), but the ONLY way to
reach it was for the chat tutor to happen to call the `get_weak_areas` tool mid-
conversation (see app/tools/get_weak_areas.py) -- a student could never simply ask the
app "what should I study next?" and get an answer. This is that missing surface, and
nothing more: it calls the exact same get_weak_areas() service function the tool calls,
and only differs in shape -- the tool renders the result as prose for a model to reason
over (format_weak_areas), this returns the same WeakArea dataclasses as plain JSON for
the Home dashboard's "What to study next" widget to render.

Deliberately as small as gamification.py (the simplest read-only router here): one GET,
no parameters, no plan gate -- this is the student's own already-recorded data, not
expensive compute.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.services.users import get_or_create_user
from app.services.weak_areas import get_weak_areas

router = APIRouter(prefix="/weak-areas", tags=["weak-areas"])


@router.get("")
async def weak_areas(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    """Ordered worst-first (the service already sorts by weak_count descending). An
    empty list is the normal answer for a student with no review/exam history yet --
    a state the UI renders as a plain "do some reviews first" note, not an error."""
    user = await get_or_create_user(db, claims)
    await db.commit()  # persist the user row if get_or_create_user just created it
    areas = await get_weak_areas(db, user.id)
    return [
        {
            "label": area.label,
            "weak_flashcards": area.weak_flashcards,
            "missed_questions": area.missed_questions,
            # Real row ids, paired 1:1 with the text lists above -- what lets the
            # desktop app open a review/exam session scoped to exactly these items
            # instead of the whole deck/exam list.
            "weak_flashcard_ids": [str(i) for i in area.weak_flashcard_ids],
            "missed_question_ids": [str(i) for i in area.missed_question_ids],
            "missed_question_exam_ids": [str(i) for i in area.missed_question_exam_ids],
            "document_id": str(area.document_id) if area.document_id is not None else None,
            # Computed property on the dataclass, not recomputed here -- the widget
            # sorts/labels by it and must agree exactly with what the tutor sees.
            "weak_count": area.weak_count,
        }
        for area in areas
    ]
