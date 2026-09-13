import json
import uuid
from datetime import datetime, timezone
from typing import Any

import fsrs
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, Flashcard, FlashcardReviewLog
from app.providers.base import ChatTurn, TextDelta
from app.providers.registry import get_provider
from app.services.documents import get_document_text

MAX_MATERIAL_CHARS = 12000

FLASHCARD_PROMPT = """You are creating flashcards from course material. \
Reply with ONLY a JSON object, no prose, in this exact shape:
{{
  "cards": [
    {{"front": "a clear, specific question or prompt", "back": "the concise correct answer"}}
  ]
}}
Focus on genuinely testable facts, definitions, and concepts a student should actively \
recall -- not vague or overly broad prompts, and not restating whole paragraphs. Aim for \
around {target_count} good cards -- that's the target, not a hard requirement: produce \
fewer if the material genuinely doesn't support that many distinct testable facts (never \
pad with vague or repetitive cards just to hit the number), and more only if the material \
clearly supports meaningfully more. If there's nothing flashcard-worthy, return \
{{"cards": []}}.

Material:
{text}
"""

# One shared, stateless scheduler instance (default FSRS weights/retention target) --
# no per-user customization yet, so there's nothing that needs a fresh instance per call.
_scheduler = fsrs.Scheduler()

_STATE_TO_ROW = {
    fsrs.State.Learning: "learning",
    fsrs.State.Review: "review",
    fsrs.State.Relearning: "relearning",
}
_ROW_TO_STATE = {v: k for k, v in _STATE_TO_ROW.items()}


def parse_flashcards(raw: str) -> list[dict[str, Any]]:
    """Pure parsing, mirroring app.services.study_planner.parse_study_plan_items."""
    try:
        start = raw.index("{")
        end = raw.rindex("}") + 1
        data = json.loads(raw[start:end])
    except (ValueError, json.JSONDecodeError):
        return []

    cards = data.get("cards", [])
    if not isinstance(cards, list):
        return []
    return [c for c in cards if isinstance(c, dict) and c.get("front") and c.get("back")]


def _card_from_row(row: Flashcard) -> fsrs.Card:
    """FSRS's own Card object, reconstructed from the persisted scheduling state --
    row.fsrs_state/step/stability/difficulty/due/last_review round-trip exactly through
    this and _apply_card_to_row, so Postgres (not the library) is the source of truth
    between reviews."""
    return fsrs.Card(
        card_id=0,  # unused: we correlate reviews via our own FlashcardReviewLog.flashcard_id
        state=_ROW_TO_STATE[row.fsrs_state],
        step=row.fsrs_step,
        stability=row.fsrs_stability,
        difficulty=row.fsrs_difficulty,
        due=row.due,
        last_review=row.last_review,
    )


def _apply_card_to_row(row: Flashcard, card: fsrs.Card) -> None:
    row.fsrs_state = _STATE_TO_ROW[card.state]
    row.fsrs_step = card.step
    row.fsrs_stability = card.stability
    row.fsrs_difficulty = card.difficulty
    row.due = card.due
    row.last_review = card.last_review


async def generate_flashcards(
    db: AsyncSession,
    user_id: uuid.UUID,
    document: Document,
    byok_anthropic_key: str | None = None,
    target_count: int = 5,
) -> list[Flashcard]:
    """Reads a document, asks the provider to extract flashcard-worthy Q&A pairs, and
    persists them as new Flashcard rows (caller commits) -- each starts at FSRS's own
    default "never reviewed" state (Card() with no stability/difficulty yet), due
    immediately, exactly like a fresh card in any spaced-repetition app. `target_count`
    is plan-scaled by the caller (see app/services/billing.py's generation_target_count)
    -- defaults to the free tier's target so any caller that forgets to pass it explicitly
    fails toward the smaller number, not an unbounded one."""
    text = await get_document_text(document)

    provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
    prompt = FLASHCARD_PROMPT.format(text=text[:MAX_MATERIAL_CHARS], target_count=target_count)

    raw = ""
    async for event in provider.stream_chat([ChatTurn(role="user", content=prompt)], model):
        if isinstance(event, TextDelta):
            raw += event.text

    rows: list[Flashcard] = []
    for item in parse_flashcards(raw):
        row = Flashcard(
            user_id=user_id,
            document_id=document.id,
            front=str(item["front"])[:2000],
            back=str(item["back"])[:2000],
        )
        db.add(row)
        rows.append(row)

    await db.flush()
    return rows


async def review_flashcard(db: AsyncSession, flashcard: Flashcard, rating: int) -> Flashcard:
    """Applies one FSRS review to a card (updating its schedule in place) and logs it.
    `rating` must be 1-4 (Again/Hard/Good/Easy) -- callers validate this before calling
    (see the router), since an invalid value should be a clean 400, not a tool-belt-style
    "Error: ..." string here."""
    card = _card_from_row(flashcard)
    new_card, _log = _scheduler.review_card(card, fsrs.Rating(rating))
    _apply_card_to_row(flashcard, new_card)

    db.add(FlashcardReviewLog(flashcard_id=flashcard.id, user_id=flashcard.user_id, rating=rating))
    await db.flush()
    return flashcard


async def get_due_flashcards(db: AsyncSession, user_id: uuid.UUID, limit: int = 50) -> list[Flashcard]:
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(Flashcard)
            .where(Flashcard.user_id == user_id, Flashcard.due <= now)
            .order_by(Flashcard.due)
            .limit(limit)
        )
    ).scalars().all()
    return list(rows)
