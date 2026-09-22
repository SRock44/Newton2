import uuid
from typing import Any

from app.db.base import SessionLocal
from app.db.models import User
from app.services import billing as billing_service
from app.services.flashcards import generate_flashcards
from app.tools.base import Tool
from app.tools.document_resolution import resolve_document


class FlashcardGenerationTool(Tool):
    """Actually creates real flashcard rows from one of the student's uploaded
    documents -- or, with no document, from a bare `topic` generated directly from the
    model's own knowledge in this same single provider call (see
    app.services.flashcards.FLASHCARD_TOPIC_PROMPT) -- so a chat request like "make me
    some flashcards on this" or "teach me X from scratch" produces real, reviewable
    cards in the Flashcards panel instead of the model just writing flashcard-shaped
    text into its reply (which has no way to end up in the app's real FSRS-scheduled
    deck). Free for every user — see StudySessionTool for the Pro-gated "do all three at
    once" composite version of this same underlying generation call (document-only)."""

    name = "generate_flashcards"
    description = (
        "Generates a real, saved set of spaced-repetition flashcards from an uploaded "
        "document, or from a bare topic (see `topic`) when the student has nothing "
        "uploaded. Call when asked for flashcards, a deck, or something to self-quiz "
        "with -- never just write flashcard-style text in your reply, since that "
        "isn't saved anywhere for later review."
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
            "include_production": {
                "type": "boolean",
                "description": (
                    "Set true ONLY for vocabulary in a language the student is "
                    "learning, or when they ask to practise producing terms rather "
                    "than just recognizing them. It doubles the deck: each card also "
                    "gets a reversed 'production' card where the student must TYPE the "
                    "term from its meaning -- a genuinely different skill for language "
                    "learning, and wasted daily review load for anything else. Default "
                    "false. Don't set it just because the student seems keen."
                ),
            },
            "topic": {
                "type": "string",
                "description": (
                    "A bare topic to generate flashcards about from your own knowledge "
                    "(e.g. 'the Krebs cycle', 'Spanish subjunctive mood') -- use this "
                    "INSTEAD of document_filename when the student has no uploaded "
                    "document yet but still wants flashcards on something. Generation "
                    "is just as fast either way; the only difference is the cards "
                    "aren't grounded in a specific uploaded source. Ignored if an "
                    "uploaded document is found, since a real document is always "
                    "preferred when one exists."
                ),
            },
        },
    }

    async def run(
        self,
        document_filename: str | None = None,
        include_production: bool = False,
        topic: str | None = None,
        user_id: str | None = None,
    ) -> str:
        if not user_id:
            return "Error: no signed-in user to generate flashcards for."
        uid = uuid.UUID(user_id)

        async with SessionLocal() as db:
            document = await resolve_document(db, uid, document_filename)
            if document is None:
                if document_filename:
                    return f"Error: no uploaded document matching '{document_filename}' found."
                if not topic:
                    return (
                        "Error: no uploaded documents to generate flashcards from yet -- "
                        "pass a topic (e.g. topic='the Krebs cycle') to generate flashcards "
                        "directly, no upload required."
                    )
            label = document.filename if document is not None else topic
            user = await db.get(User, uid)
            target_count = billing_service.generation_target_count(user)

            try:
                cards = await generate_flashcards(
                    db,
                    uid,
                    document,
                    target_count=target_count,
                    include_production_cards=bool(include_production),
                    topic=None if document is not None else topic,
                )
                await db.commit()
            except Exception as exc:
                return f"Error: flashcard generation failed ({exc})."

        suffix = (
            " Half of them are typed 'production' cards: you'll be shown the meaning and "
            "have to type the term."
            if include_production
            else ""
        )
        return (
            f"Generated {len(cards)} flashcard(s) from '{label}' — check the "
            f"Flashcards panel to review them.{suffix}"
        )
