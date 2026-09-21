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

# Used INSTEAD of STUDY_PLAN_PROMPT when the student has no uploaded document and gave a
# bare topic instead (see generate_study_plan below). This is NOT a reworded copy of
# STUDY_PLAN_PROMPT -- it's a genuinely different task. STUDY_PLAN_PROMPT is semantically
# an EXTRACTOR: it only ever pulls out items that were already there in a syllabus
# ("Only include real, gradable items... If the syllabus has no extractable schedule,
# return {{"items": []}}"), so pointing it at generated or absent material would likely
# just return an empty plan -- there's nothing "gradable" to extract when nothing was
# handed to it. What a self-directed learner starting from zero actually needs is a
# CURRICULUM CONSTRUCTOR: build a sensible, well-ordered sequence of study units for the
# topic from the model's own knowledge of how it's normally taught, foundational-first.
# There are no real deadlines here (this isn't a graded course), so due_date is always
# null and due_date_text becomes an ordering label instead of a calendar reference.
#
# Honest tradeoff, stated plainly: this curriculum isn't grounded in a real fetched
# source the way a syllabus-derived plan is -- it's only as good as the model's own
# training-time knowledge of how the subject is normally sequenced. That's acceptable:
# it's exactly how a bare chatbot would answer "give me a study plan for X" anyway, and
# what actually differentiates Newton is what happens AFTER this list exists -- the
# items become real, trackable rows, and pairing with generate_flashcards/
# generate_practice_exam on the same topic gets real FSRS scheduling and weak-area
# tracking a bare chat session can never provide, regardless of how the topic list itself
# was grounded.
STUDY_PLAN_TOPIC_PROMPT = """You are constructing a sensible, well-sequenced multi-topic study \
curriculum for a self-directed learner who wants to study {topic} from scratch -- there is no \
syllabus, course, or document to work from, so build this directly from your own knowledge of how \
{topic} is normally taught, sequencing units from foundational to advanced. Reply with ONLY a JSON \
object, no prose, in this exact shape:
{{
  "items": [
    {{
      "title": "short name of this study unit (e.g. 'Vectors and vector spaces')",
      "due_date": null,
      "due_date_text": "a short ordering label, e.g. 'Step 1', 'Step 2', ...",
      "notes": "one or two sentences on what this unit covers and why it belongs at this point in the sequence"
    }}
  ]
}}
This is a self-paced curriculum, not a graded course, so there are no real due dates -- due_date \
must always be null for every item. Break {topic} into a sensible number of discrete, well-ordered \
study units (typically 5-12, depending on how broad the topic is), each a genuine, coherent chunk \
of material, sequenced so each unit builds on the ones before it. Unlike extracting from a \
syllabus, there is always real material to build a curriculum from for a genuine academic topic -- \
don't return an empty list.

Topic: {topic}
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
    document: Document | None,
    byok_anthropic_key: str | None = None,
    topic: str | None = None,
) -> list[StudyPlanItem]:
    """Reads a syllabus document, asks the provider to extract a structured schedule,
    and persists the result as StudyPlanItem rows (caller commits). Any item the model
    invents without a title is already filtered by parse_study_plan_items; any date it
    gives that doesn't parse as YYYY-MM-DD is kept as due_date_text only rather than
    guessed at.

    `document` is None exactly on the bare-topic path (see `topic`) -- callers pass
    exactly one, never both, never neither (a ValueError if so -- a programming error,
    not a user-facing one). Passing `document` behaves completely unchanged from before
    `topic` existed: same STUDY_PLAN_PROMPT extraction, same single provider call, same
    persisted rows. `topic` uses the genuinely different STUDY_PLAN_TOPIC_PROMPT
    curriculum-construction prompt instead (see its module comment for why this can't
    just be a reworded STUDY_PLAN_PROMPT) -- still exactly one provider call, no added
    latency or cost versus the document path. Resulting items have document_id=None
    (nullable for exactly this) and source="topic_generated"."""
    if document is None and not topic:
        raise ValueError("generate_study_plan needs either a document or a topic.")

    if document is not None:
        text = await get_document_text(document)
        provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
        prompt = STUDY_PLAN_PROMPT.format(text=text[:MAX_SYLLABUS_CHARS])
    else:
        provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
        prompt = STUDY_PLAN_TOPIC_PROMPT.format(topic=topic)

    raw = ""
    async for event in provider.stream_chat([ChatTurn(role="user", content=prompt)], model):
        if isinstance(event, TextDelta):
            raw += event.text

    document_id = document.id if document is not None else None
    source = "syllabus_upload" if document is not None else "topic_generated"

    rows: list[StudyPlanItem] = []
    for item in parse_study_plan_items(raw):
        row = StudyPlanItem(
            user_id=user_id,
            document_id=document_id,
            title=str(item["title"])[:500],
            due_date=_parse_due_date(item.get("due_date")),
            due_date_text=item.get("due_date_text") if isinstance(item.get("due_date_text"), str) else None,
            notes=item.get("notes") if isinstance(item.get("notes"), str) else None,
            source=source,
        )
        db.add(row)
        rows.append(row)

    await db.flush()
    return rows
