import uuid
from typing import Any

from app.db.base import SessionLocal
from app.services.study_planner import generate_study_plan
from app.tools.base import Tool
from app.tools.document_resolution import resolve_document


class StudyPlanGenerationTool(Tool):
    """Actually extracts real, saved study plan items (due dates/assignments) from one
    of the student's uploaded documents -- or, with no document, CONSTRUCTS a
    well-sequenced multi-unit curriculum for a bare `topic` directly from the model's
    own knowledge, in this same single provider call (see
    app.services.study_planner.STUDY_PLAN_TOPIC_PROMPT -- a genuinely different prompt
    from the document-extraction one, not a reworded version of it, since "extract the
    real gradable items" and "construct a sensible curriculum from scratch" are
    different tasks). So a chat request like "build me a study plan from my syllabus"
    OR "teach me linear algebra from zero" both produce something real to see in the
    Study Plan panel instead of the model just describing a plan in its reply."""

    name = "generate_study_plan"
    description = (
        "Extracts due dates/assignments from an uploaded document (e.g. a syllabus) "
        "into a real, saved study plan -- or, with no document, builds a sensible "
        "multi-topic study curriculum for a bare topic (see `topic`) from scratch. "
        "Call when asked for a study plan, a schedule, help tracking deadlines, or to "
        "learn a subject from the ground up -- never just describe a plan in your "
        "reply, since that isn't saved anywhere to track."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "document_filename": {
                "type": "string",
                "description": (
                    "Filename or substring matching an uploaded document (e.g. "
                    "'syllabus'). Omit to use the most recently uploaded one."
                ),
            },
            "topic": {
                "type": "string",
                "description": (
                    "A bare topic to build a self-study curriculum for from your own "
                    "knowledge (e.g. 'linear algebra', 'the French Revolution') -- use "
                    "this INSTEAD of document_filename when the student has no "
                    "uploaded syllabus/document but wants a study plan anyway (e.g. "
                    "'teach me X from scratch'). This builds a sequenced list of study "
                    "units, not extracted deadlines -- there are no real due dates. "
                    "Ignored if an uploaded document is found, since a real syllabus is "
                    "always preferred when one exists."
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
            return "Error: no signed-in user to generate a study plan for."
        uid = uuid.UUID(user_id)

        async with SessionLocal() as db:
            document = await resolve_document(db, uid, document_filename)
            if document is None:
                if document_filename:
                    return f"Error: no uploaded document matching '{document_filename}' found."
                if not topic:
                    return (
                        "Error: no uploaded documents to generate a study plan from yet "
                        "-- pass a topic (e.g. topic='linear algebra') to build a study "
                        "curriculum directly, no upload required."
                    )
            label = document.filename if document is not None else topic

            try:
                items = await generate_study_plan(
                    db, uid, document, topic=None if document is not None else topic
                )
                await db.commit()
            except Exception as exc:
                return f"Error: study plan generation failed ({exc})."

        return (
            f"Added {len(items)} study plan item(s) from '{label}' — check the "
            "Study Plan panel to see them."
        )
