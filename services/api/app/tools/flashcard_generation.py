import uuid
from typing import Any

from app.db.base import SessionLocal
from app.services.flashcards import generate_flashcards
from app.tools.base import Tool
from app.tools.document_resolution import resolve_document


class FlashcardGenerationTool(Tool):
    """Actually creates real flashcard rows from one of the student's uploaded
    documents, so a chat request like "make me some flashcards on this" produces real,
    reviewable cards in the Flashcards panel instead of the model just writing
    flashcard-shaped text into its reply (which has no way to end up in the app's real
    FSRS-scheduled deck). Free for every user — see StudySessionTool for the Pro-gated
    "do all three at once" composite version of this same underlying generation call."""

    name = "generate_flashcards"
    description = (
        "Generates a real, saved set of spaced-repetition flashcards from one of the "
        "student's uploaded documents. Call this whenever the student asks for "
        "flashcards, a deck, or something to quiz themselves with from their course "
        "material — never just write flashcard-style text directly in your reply, "
        "since that wouldn't actually be saved anywhere for them to review later."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "document_filename": {
                "type": "string",
                "description": (
                    "A filename or substring to match against the student's uploaded "
                    "documents (e.g. 'biology' or 'syllabus.pdf'). Omit to use their "
                    "most recently uploaded document."
                ),
            },
        },
    }

    async def run(self, document_filename: str | None = None, user_id: str | None = None) -> str:
        if not user_id:
            return "Error: no signed-in user to generate flashcards for."
        uid = uuid.UUID(user_id)

        async with SessionLocal() as db:
            document = await resolve_document(db, uid, document_filename)
            if document is None:
                if document_filename:
                    return f"Error: no uploaded document matching '{document_filename}' found."
                return "Error: no uploaded documents to generate flashcards from yet."
            filename = document.filename

            try:
                cards = await generate_flashcards(db, uid, document)
                await db.commit()
            except Exception as exc:
                return f"Error: flashcard generation failed ({exc})."

        return (
            f"Generated {len(cards)} flashcard(s) from '{filename}' — check the "
            "Flashcards panel to review them."
        )
