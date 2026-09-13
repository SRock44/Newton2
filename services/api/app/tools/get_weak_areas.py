import uuid
from typing import Any

from app.db.base import SessionLocal
from app.services.weak_areas import format_weak_areas, get_weak_areas
from app.tools.base import Tool


class GetWeakAreasTool(Tool):
    """Thin tool wrapper around app.services.weak_areas -- the actual gap this tool
    exists to close: real, structured performance data (FlashcardReviewLog ratings,
    PracticeExamQuestion correctness) already exists in the DB but the Tutor never
    looked at it. No parameters beyond the standard user_id context param; this always
    answers "how is the currently signed-in student actually doing" from their own
    data."""

    name = "get_weak_areas"
    description = (
        "Looks at the student's REAL performance data -- flashcard review history and "
        "completed practice exam results -- and surfaces which documents/topics they "
        "are actually struggling with, with real example questions/cards, not just "
        "counts. Call this when a student asks what to study, what they're bad at, or "
        "whether they're ready for an exam, and consider calling it proactively before "
        "generating a new practice exam or flashcard set so it can be targeted at real "
        "weak spots instead of guessed."
    )
    parameters: dict[str, Any] = {"type": "object", "properties": {}}

    async def run(self, user_id: str | None = None) -> str:
        if not user_id:
            return "Error: no signed-in user to look up performance data for."
        uid = uuid.UUID(user_id)
        async with SessionLocal() as db:
            areas = await get_weak_areas(db, uid)
        return format_weak_areas(areas)
