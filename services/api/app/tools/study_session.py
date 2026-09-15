import asyncio
import uuid
from typing import Any

from app.db.base import SessionLocal
from app.db.models import Document, User
from app.services import billing as billing_service
from app.services.flashcards import generate_flashcards
from app.services.practice_exams import generate_practice_exam, get_exam_questions
from app.services.study_planner import generate_study_plan
from app.tools.base import Tool
from app.tools.document_resolution import resolve_document

PRO_ONLY_MESSAGE = (
    "Preparing a full study session in one go is a Pro feature — you can still "
    "generate a study plan, flashcards, or a practice exam individually."
)


async def _generate_study_plan_isolated(user_id: uuid.UUID, document_id: uuid.UUID) -> int:
    async with SessionLocal() as db:
        document = await db.get(Document, document_id)
        items = await generate_study_plan(db, user_id, document)
        await db.commit()
        return len(items)


async def _generate_flashcards_isolated(user_id: uuid.UUID, document_id: uuid.UUID) -> int:
    async with SessionLocal() as db:
        document = await db.get(Document, document_id)
        # This whole tool is Pro-gated before any generation runs (see run() below), so
        # every caller reaching here is Pro -- no need to re-fetch the user just to look
        # up a plan that's already known.
        cards = await generate_flashcards(
            db, user_id, document, target_count=billing_service.PRO_GENERATION_TARGET
        )
        await db.commit()
        return len(cards)


async def _generate_practice_exam_isolated(user_id: uuid.UUID, document_id: uuid.UUID) -> tuple[int, str]:
    async with SessionLocal() as db:
        document = await db.get(Document, document_id)
        exam = await generate_practice_exam(
            db, user_id, document, num_questions=billing_service.PRO_GENERATION_TARGET
        )
        await db.commit()
        # question count needs a fresh query -- `exam` doesn't eagerly load the relationship
        questions = await get_exam_questions(db, exam.id)
        return len(questions), exam.difficulty


class StudySessionTool(Tool):
    """Composes the three existing generation features (Study Planner, Flashcards,
    Practice Exams) into one request instead of the student invoking each separately —
    the actual "multi-agent workflow" this roadmap item asked for, built as a
    composition of tools that already exist rather than a parallel second architecture.
    The three generations run concurrently (each on its own DB session -- AsyncSession
    isn't safe to share across concurrent coroutines), which is also genuinely faster
    wall-clock than doing them one at a time, since each makes its own real call to the
    provider."""

    name = "start_study_session"
    description = (
        "Prepares a full study session from an uploaded document in one shot: study "
        "plan items, flashcards, and a practice exam, all at once. Call when asked to "
        "prepare for an exam/quiz/test or wants a comprehensive review, instead of "
        "doing each of those individually yourself."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "document_filename": {
                "type": "string",
                "description": (
                    "Filename or substring matching an uploaded document (e.g. "
                    "'biology'). Omit to use the most recently uploaded one."
                ),
            },
        },
    }

    async def run(self, document_filename: str | None = None, user_id: str | None = None) -> str:
        if not user_id:
            return "Error: no signed-in user to build a study session for."
        uid = uuid.UUID(user_id)

        async with SessionLocal() as db:
            user = await db.get(User, uid)
            if user is None or not billing_service.is_pro(user):
                return PRO_ONLY_MESSAGE

            document = await resolve_document(db, uid, document_filename)
            if document is None:
                if document_filename:
                    return f"Error: no uploaded document matching '{document_filename}' found."
                return "Error: no uploaded documents to build a study session from yet."
            document_id, filename = document.id, document.filename

        try:
            plan_count, card_count, (exam_question_count, exam_difficulty) = await asyncio.gather(
                _generate_study_plan_isolated(uid, document_id),
                _generate_flashcards_isolated(uid, document_id),
                _generate_practice_exam_isolated(uid, document_id),
            )
        except Exception as exc:
            return f"Error: study session generation failed partway through ({exc})."

        return (
            f"Study session ready from '{filename}': {plan_count} study plan item(s) added, "
            f"{card_count} flashcard(s) generated, and a {exam_question_count}-question "
            f"practice exam built at {exam_difficulty} difficulty. Check Study Plan, "
            f"Flashcards, and Practice Exams to dig in."
        )
