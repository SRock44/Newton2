import json
import uuid
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, StudyPlanItem
from app.providers.base import ChatTurn, TextDelta
from app.providers.registry import get_provider
from app.services.documents import get_document_text

# Keep the prompt bounded even for a long syllabus -- this is context for extraction,
# not a document users read, and every provider has a finite context window anyway.
MAX_SYLLABUS_CHARS = 12000

STUDY_PLAN_PROMPT = """You are extracting a structured study plan from a course syllabus. \
Reply with ONLY a JSON object, no prose, in this exact shape:
{{
  "items": [
    {{
      "title": "short assignment/exam/reading name",
      "due_date": "YYYY-MM-DD, or null if the syllabus doesn't give an exact calendar date",
      "due_date_text": "the syllabus's own words for when this is due (e.g. 'Week 5', 'Midterm week') -- always include this even when due_date is a real date",
      "notes": "brief context such as weight or format, or null"
    }}
  ]
}}
Only include real, gradable items (assignments, exams, projects, specific graded readings) -- \
not general course policies, office hours, or the grading scale. If the syllabus has no \
extractable schedule, return {{"items": []}}.

Syllabus text:
{text}
"""


def parse_study_plan_items(raw: str) -> list[dict[str, Any]]:
    """Pure parsing, mirroring app.jobs.consolidate._parse_summary: extract the JSON
    object from the model's raw output and keep only items with at least a title. No
    real model is configured in this dev environment (see EchoProvider), so this will
    typically see unparseable echoed text and correctly return an empty list rather
    than fabricating study-plan items."""
    try:
        start = raw.index("{")
        end = raw.rindex("}") + 1
        data = json.loads(raw[start:end])
    except (ValueError, json.JSONDecodeError):
        return []

    items = data.get("items", [])
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and item.get("title")]


def _parse_due_date(raw_date: Any) -> date | None:
    if not raw_date or not isinstance(raw_date, str):
        return None
    try:
        return date.fromisoformat(raw_date)
    except ValueError:
        return None


async def generate_study_plan(
    db: AsyncSession,
    user_id: uuid.UUID,
    document: Document,
    byok_anthropic_key: str | None = None,
) -> list[StudyPlanItem]:
    """Reads a syllabus document, asks the provider to extract a structured schedule,
    and persists the result as StudyPlanItem rows (caller commits). Any item the model
    invents without a title is already filtered by parse_study_plan_items; any date it
    gives that doesn't parse as YYYY-MM-DD is kept as due_date_text only rather than
    guessed at."""
    text = await get_document_text(document)

    provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
    prompt = STUDY_PLAN_PROMPT.format(text=text[:MAX_SYLLABUS_CHARS])

    raw = ""
    async for event in provider.stream_chat([ChatTurn(role="user", content=prompt)], model):
        if isinstance(event, TextDelta):
            raw += event.text

    rows: list[StudyPlanItem] = []
    for item in parse_study_plan_items(raw):
        row = StudyPlanItem(
            user_id=user_id,
            document_id=document.id,
            title=str(item["title"])[:500],
            due_date=_parse_due_date(item.get("due_date")),
            due_date_text=item.get("due_date_text") if isinstance(item.get("due_date_text"), str) else None,
            notes=item.get("notes") if isinstance(item.get("notes"), str) else None,
            source="syllabus_upload",
        )
        db.add(row)
        rows.append(row)

    await db.flush()
    return rows
