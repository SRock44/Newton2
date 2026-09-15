import uuid

from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import ChatMessage, ChatSession
from app.providers.base import ChatTurn, TextDelta
from app.providers.registry import get_provider

# Kept small on purpose: a handful of early messages is enough context for a short
# title, and keeps the prompt (and the model call) cheap -- this mirrors
# app/jobs/consolidate.py's own "keep it cheap" stance, just scoped to a smaller
# prefix instead of the whole session transcript.
TITLE_PROMPT_MESSAGE_LIMIT = 6

MAX_TITLE_LENGTH = 60

TITLE_PROMPT = """Reply with ONLY a short 4-6 word title for this conversation. No \
punctuation, no quotes, no prefix like "Title:" -- just the words.

Conversation:
{transcript}
"""


def _clean_title(raw: str) -> str:
    """Defensively strips whatever a model hands back into a clean, storable title --
    models asked for "just the words" still sometimes add a leading "Title:", wrap the
    answer in quotes, or add trailing punctuation."""
    cleaned = raw.strip()
    if cleaned.lower().startswith("title:"):
        cleaned = cleaned[len("title:") :].strip()
    cleaned = cleaned.strip("\"'“”‘’").strip()
    cleaned = " ".join(cleaned.split())  # collapse internal newlines/repeated whitespace
    return cleaned[:MAX_TITLE_LENGTH].strip()


async def generate_session_title(ctx: dict, session_id: str) -> None:
    """Writes a real, model-generated title onto ChatSession.title (a column that
    otherwise sits unused forever -- app/lib/sessionTitle.ts's sessionDisplayTitle
    already prefers it when present, falling back to a truncated first message
    otherwise, so the frontend needs no changes to actually use one once it exists).

    Modeled directly on app/jobs/consolidate.py's consolidate_session: same
    SessionLocal pattern, same "assemble a small transcript prefix, one cheap call via
    get_provider(), parse/clean a small result, write it back" shape.

    No-ops entirely if session.title is already set -- avoids clobbering a title
    (whether set by an earlier run of this same job, or, one day, a user's own rename),
    and makes a duplicate enqueue (see chat.py's trigger, which is belt-and-suspenders
    around this same check) harmless rather than wasteful."""
    async with SessionLocal() as db:
        session = await db.get(ChatSession, uuid.UUID(session_id))
        if session is None:
            return
        if session.title is not None and session.title.strip():
            return

        messages = (
            (
                await db.execute(
                    select(ChatMessage)
                    .where(ChatMessage.session_id == uuid.UUID(session_id))
                    .order_by(ChatMessage.created_at)
                    .limit(TITLE_PROMPT_MESSAGE_LIMIT)
                )
            )
            .scalars()
            .all()
        )
        if not messages:
            return

        transcript = "\n".join(f"{m.role}: {m.content}" for m in messages)
        prompt = TITLE_PROMPT.format(transcript=transcript)

        provider, model = get_provider()
        raw = ""
        # No `tools=` passed, so this will only ever yield TextDelta events.
        async for event in provider.stream_chat([ChatTurn(role="user", content=prompt)], model):
            if isinstance(event, TextDelta):
                raw += event.text

        title = _clean_title(raw)
        if not title:
            return  # no real model configured (or it returned nothing usable) -- skip

        session.title = title
        await db.commit()
