import uuid
from typing import Any

from app.db.base import SessionLocal
from app.services.study_planner import generate_study_plan
from app.tools.base import Tool
from app.tools.document_resolution import resolve_document


class StudyPlanGenerationTool(Tool):
    """Actually extracts real, saved study plan items (due dates/assignments) from one
    of the student's uploaded documents, so a chat request like "build me a study plan
    from my syllabus" produces something real to see in the Study Plan panel instead of
    the model just describing a plan in its reply."""

    name = "generate_study_plan"
    description = (
        "Extracts due dates/assignments from an uploaded document (e.g. a syllabus) "
        "into a real, saved study plan. Call when asked for a study plan, a "
        "schedule, or help tracking deadlines -- never just describe a plan in your "
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
        },
    }

    async def run(self, document_filename: str | None = None, user_id: str | None = None) -> str:
        if not user_id:
            return "Error: no signed-in user to generate a study plan for."
        uid = uuid.UUID(user_id)

        async with SessionLocal() as db:
            document = await resolve_document(db, uid, document_filename)
            if document is None:
                if document_filename:
                    return f"Error: no uploaded document matching '{document_filename}' found."
                return "Error: no uploaded documents to generate a study plan from yet."
            filename = document.filename

            try:
                items = await generate_study_plan(db, uid, document)
                await db.commit()
            except Exception as exc:
                return f"Error: study plan generation failed ({exc})."

        return (
            f"Added {len(items)} study plan item(s) from '{filename}' — check the "
            "Study Plan panel to see them."
        )
