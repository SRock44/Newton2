import uuid
from typing import Any

from app.db.base import SessionLocal
from app.db.models import User
from app.services import billing as billing_service
from app.services.practice_exams import generate_practice_exam, get_exam_questions
from app.tools.base import Tool
from app.tools.document_resolution import resolve_document


class PracticeExamGenerationTool(Tool):
    """Actually creates a real, saved practice exam from one of the student's uploaded
    documents, so a chat request like "quiz me on this" or "give me a practice test"
    produces something real to take in the Practice Exams panel instead of the model
    just writing quiz-shaped text into its reply."""

    name = "generate_practice_exam"
    description = (
        "Generates a real, saved practice exam (multiple-choice) from an uploaded "
        "document. Call when asked to be quizzed/tested or wants practice questions "
        "-- never just write quiz questions in your reply, since that isn't saved "
        "anywhere to take or get graded on."
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
            return "Error: no signed-in user to generate a practice exam for."
        uid = uuid.UUID(user_id)

        async with SessionLocal() as db:
            document = await resolve_document(db, uid, document_filename)
            if document is None:
                if document_filename:
                    return f"Error: no uploaded document matching '{document_filename}' found."
                return "Error: no uploaded documents to generate a practice exam from yet."
            filename = document.filename
            user = await db.get(User, uid)
            target_count = billing_service.generation_target_count(user)

            try:
                exam = await generate_practice_exam(db, uid, document, num_questions=target_count)
                await db.commit()
                questions = await get_exam_questions(db, exam.id)
            except Exception as exc:
                return f"Error: practice exam generation failed ({exc})."

        return (
            f"Built a {len(questions)}-question practice exam ({exam.difficulty} difficulty) "
            f"from '{filename}' — check the Practice Exams panel to take it."
        )
