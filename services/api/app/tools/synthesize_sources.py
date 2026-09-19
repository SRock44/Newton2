import uuid
from typing import Any

from app.db.base import SessionLocal
from app.services.synthesis import synthesize_sources
from app.tools.base import Tool


class SynthesizeSourcesTool(Tool):
    """Cross-document synthesis over the student's OWN uploaded readings -- the first
    real step of writing an argumentative essay ("what do these sources agree/disagree
    on") that a bare chatbot with no persistent, searchable corpus of a student's own
    documents can't do at all. Reuses the same document-RAG infrastructure
    generate_flashcards/generate_study_plan use (app.tools.document_resolution,
    app.memory.rag), extended so retrieval draws real chunks from EACH source document
    rather than a single merged top-k where one document could dominate. See
    app.services.synthesis for the real retrieval + grounding logic."""

    name = "synthesize_sources"
    description = (
        "Compares two or more of the student's OWN uploaded documents against each "
        "other: what they agree on, where they genuinely disagree or emphasize "
        "different things, and how one builds on or responds to another -- grounded in "
        "real retrieved excerpts from each source, never a single document standing in "
        "for several. Call this when asked to compare, synthesize, or find "
        "agreement/disagreement across multiple readings -- never just describe one "
        "document's own content, and never invent what a source says beyond what was "
        "actually retrieved."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "document_names": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Filenames or substrings of the specific documents to compare (e.g. "
                    "['smith-article.pdf', 'jones-response.pdf']). Give this when the "
                    "student named specific readings. Omit and use `topic` instead when "
                    "they didn't."
                ),
            },
            "topic": {
                "type": "string",
                "description": (
                    "The topic/question to synthesize around, e.g. 'causes of the "
                    "French Revolution' or 'these authors' views on free will'. Used "
                    "both to find which of the student's documents are relevant (when "
                    "document_names isn't given) and to focus which real passages are "
                    "pulled from each one."
                ),
            },
        },
    }

    async def run(
        self,
        document_names: list[str] | None = None,
        topic: str | None = None,
        user_id: str | None = None,
    ) -> str:
        if not user_id:
            return "Error: no signed-in user to synthesize documents for."
        if not document_names and not topic:
            return "Error: give either document_names or a topic to synthesize across."
        uid = uuid.UUID(user_id)
        async with SessionLocal() as db:
            try:
                return await synthesize_sources(db, uid, document_names=document_names, topic=topic)
            except Exception as exc:
                return f"Error: synthesis failed ({exc})."
