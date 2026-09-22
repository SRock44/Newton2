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
    documents -- or, with no document, from a bare `topic` generated directly from the
    model's own knowledge in this same single provider call (see
    app.services.practice_exams.EXAM_TOPIC_PROMPT) -- so a chat request like "quiz me
    on this" or "give me a practice test on X" produces something real to take in the
    Practice Exams panel instead of the model just writing quiz-shaped text into its
    reply."""

    name = "generate_practice_exam"
    description = (
        "Generates a real, saved practice exam (multiple-choice) from an uploaded "
        "document, or from a bare topic (see `topic`) when the student has nothing "
        "uploaded. Call when asked to be quizzed/tested or wants practice questions "
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
            "topic": {
                "type": "string",
                "description": (
                    "A bare topic to write practice exam questions about from your own "
                    "knowledge (e.g. 'World War I', 'SQL joins') -- use this INSTEAD of "
                    "document_filename when the student has no uploaded document yet "
                    "but still wants to be quizzed on something. Generation is just as "
                    "fast either way; the only difference is the questions aren't "
                    "grounded in a specific uploaded source. Ignored if an uploaded "
                    "document is found, since a real document is always preferred when "
                    "one exists."
                ),
            },
        },
    }

    async def run(
        self,
        document_filename: str | None = None,
        topic: str | None = None,
        user_id: str | None = None,
    ) -> str:
        if not user_id:
            return "Error: no signed-in user to generate a practice exam for."
        uid = uuid.UUID(user_id)

        async with SessionLocal() as db:
            document = await resolve_document(db, uid, document_filename)
            if document is None:
                if document_filename:
                    return f"Error: no uploaded document matching '{document_filename}' found."
                if not topic:
                    return (
                        "Error: no uploaded documents to generate a practice exam from "
                        "yet -- pass a topic (e.g. topic='World War I') to generate a "
                        "practice exam directly, no upload required."
                    )
            label = document.filename if document is not None else topic
            user = await db.get(User, uid)
            target_count = billing_service.generation_target_count(user)

            try:
                exam = await generate_practice_exam(
                    db,
                    uid,
                    document,
                    num_questions=target_count,
                    topic=None if document is not None else topic,
                )
                await db.commit()
                questions = await get_exam_questions(db, exam.id)
            except Exception as exc:
                return f"Error: practice exam generation failed ({exc})."

        return (
            f"Built a {len(questions)}-question practice exam ({exam.difficulty} difficulty) "
            f"from '{label}' — check the Practice Exams panel to take it."
        )
