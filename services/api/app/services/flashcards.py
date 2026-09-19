import json
import re
import unicodedata
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

# --------------------------------------------------------------------------------------
# Direction -- recognition vs. production.
# --------------------------------------------------------------------------------------

DIRECTION_RECOGNITION = "recognition"
DIRECTION_PRODUCTION = "production"
DIRECTIONS = (DIRECTION_RECOGNITION, DIRECTION_PRODUCTION)


def card_direction(row: Flashcard) -> str:
    """NULL means recognition. Every row written before migration 0021 has NULL, and
    reading it as "recognition" here is what lets that migration skip a backfill: there
    is exactly one place in the codebase that has to know, and this is it."""
    return row.direction or DIRECTION_RECOGNITION


# One shared, stateless scheduler instance (default FSRS weights/retention target) --
# no per-user customization yet, so there's nothing that needs a fresh instance per call.
#
# Worth stating explicitly now that two cards can exist for one term: fsrs.Scheduler
# holds only configuration (parameters, desired_retention, learning/relearning steps,
# maximum_interval, fuzzing), and Scheduler.review_card copies the Card it is handed and
# derives the new state purely from that copy's own fields plus the rating. There is no
# per-card or cross-card state anywhere in the library, so two Flashcard rows -- e.g. a
# term's recognition card and its production card -- schedule completely independently
# by construction. That is the whole reason direction is modelled as a separate ROW
# rather than a flag with two sets of scheduling columns.
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


# --------------------------------------------------------------------------------------
# Grading a typed (production-direction) answer.
#
# The forgiving spirit here is the one app/tools/create_artifact.py's quiz persona
# already spells out for generated quizzes ("Check typed answers forgivingly (trim,
# case-fold, ignore punctuation and a leading 'the'/'a'). A student marked wrong over a
# capital letter closes the tab and doesn't come back"). It is deliberately NOT a
# verbatim copy of that rule, because that rule is English-shaped and this code runs on
# vocabulary in other languages. What changed, and why:
#
#   * Unicode normalization (NFC) happens first, so a "é" typed as e + U+0301 by one IME
#     and stored as U+00E9 by another compare equal. Without this, two visually identical
#     strings are simply unequal and the student is told they are wrong.
#   * A missing accent is scored "close", not "wrong" (see grade_production_answer).
#   * The leading-article rule stays English-only, on purpose -- see _LEADING_ARTICLE_RE.
#
# KNOWN LIMITATION, stated plainly rather than papered over: this pass does not serve
# CJK scripts properly. Chinese/Japanese/Korean text has no spaces and no case, so most
# of the normalization below is a no-op there, and the accent-folding tier is actively
# wrong for tone-marked pinyin -- "mā/má/mǎ/mà" are four different words, not four
# spellings of one, so folding the tone mark off would award "close" for an answer that
# is simply a different word. _has_cjk below disables the folding tier when the expected
# answer contains Han/kana/Hangul, which covers characters-based answers; pinyin typed in
# Latin script is indistinguishable from Spanish here and is NOT handled. Doing this
# right needs a per-card language tag, which is out of scope for this pass.
# --------------------------------------------------------------------------------------

GRADE_CORRECT = "correct"
GRADE_CLOSE = "close"
GRADE_WRONG = "wrong"

# How a grade becomes an FSRS rating. Chosen, not arbitrary:
#   correct -> 3 (Good), never 4 (Easy). Easy means "I knew this instantly and it was
#     trivial" -- a judgement only the student can make, and auto-awarding it would
#     inflate intervals for every merely-correct answer.
#   close   -> 2 (Hard). The student retrieved the word; they spelled it imperfectly.
#     Hard counts the review as a success but pulls the next one in, which is exactly
#     what you want for a term whose spelling is still shaky.
#   wrong   -> 1 (Again).
PRODUCTION_RATINGS = {GRADE_CORRECT: 3, GRADE_CLOSE: 2, GRADE_WRONG: 1}

# English only, and deliberately so. "the mitochondria" / "mitochondria" is a typing
# habit, not a knowledge difference. The equivalent Romance-language articles (el/la/
# les/der/die/das ...) are NOT stripped, because in those languages the article carries
# grammatical gender and gender is part of what a vocabulary card teaches -- silently
# accepting "casa" for "la casa" would mark a student correct for the thing they were
# being asked to learn.
_LEADING_ARTICLE_RE = re.compile(r"^(?:the|an|a)\s+")
_WHITESPACE_RE = re.compile(r"\s+")
# Han, Hiragana, Katakana, CJK Ext-A, compatibility ideographs, Hangul syllables.
_CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]")


def _strip_edge_punctuation(text: str) -> str:
    """Punctuation at either end only -- a trailing "." or a wrapping quote is noise,
    but the hyphen in "self-esteem" and the apostrophe in "don't" are spelling."""
    start, end = 0, len(text)
    while start < end and unicodedata.category(text[start]).startswith("P"):
        start += 1
    while end > start and unicodedata.category(text[end - 1]).startswith("P"):
        end -= 1
    return text[start:end]


def normalize_production_answer(text: str) -> str:
    """Trim, collapse internal whitespace, case-fold, drop edge punctuation and a leading
    English article. Accents are PRESERVED here -- folding them away is a separate,
    weaker comparison (see fold_diacritics) used only for the "close" tier."""
    normalized = unicodedata.normalize("NFC", text)
    normalized = _WHITESPACE_RE.sub(" ", normalized).strip().casefold()
    normalized = _strip_edge_punctuation(normalized).strip()
    without_article = _LEADING_ARTICLE_RE.sub("", normalized, count=1)
    # "a" on its own (or "the") is a legitimate answer on, say, a grammar card -- never
    # let the article rule empty a string out.
    return without_article if without_article else normalized


def fold_diacritics(text: str) -> str:
    """"recuperación" -> "recuperacion". Decompose, drop the combining marks, recompose."""
    decomposed = unicodedata.normalize("NFD", text)
    return unicodedata.normalize(
        "NFC", "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    )


def _has_cjk(text: str) -> bool:
    return _CJK_RE.search(text) is not None


def grade_production_answer(typed: str, expected: str) -> tuple[str, int]:
    """Grades a typed production answer against the card's real answer, returning
    (grade, fsrs_rating).

    Three tiers:
      * exact after normalization                 -> "correct" (rating 3, Good)
      * equal only once accents are folded away   -> "close"   (rating 2, Hard)
      * anything else                             -> "wrong"   (rating 1, Again)

    The middle tier is the considered call. A Spanish student who types "recuperacion"
    for "recuperación" has demonstrated the retrieval this card exists to train, and
    failing them outright over a diacritic they may not have a key for is the
    "closes the tab and doesn't come back" failure mode. But the accent IS part of the
    correct spelling (and in Spanish it is phonemic -- "papa"/"papá" are different
    words), so it isn't fully right either. Hard: credited, and asked again sooner.

    Not applied when the expected answer contains CJK characters -- see the module
    comment above on why folding is wrong for tone-marked text."""
    typed_norm = normalize_production_answer(typed)
    expected_norm = normalize_production_answer(expected)

    if not typed_norm:
        return GRADE_WRONG, PRODUCTION_RATINGS[GRADE_WRONG]
    if typed_norm == expected_norm:
        return GRADE_CORRECT, PRODUCTION_RATINGS[GRADE_CORRECT]
    if not _has_cjk(expected_norm) and fold_diacritics(typed_norm) == fold_diacritics(expected_norm):
        return GRADE_CLOSE, PRODUCTION_RATINGS[GRADE_CLOSE]
    return GRADE_WRONG, PRODUCTION_RATINGS[GRADE_WRONG]


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
    include_production_cards: bool = False,
) -> list[Flashcard]:
    """Reads a document, asks the provider to extract flashcard-worthy Q&A pairs, and
    persists them as new Flashcard rows (caller commits) -- each starts at FSRS's own
    default "never reviewed" state (Card() with no stability/difficulty yet), due
    immediately, exactly like a fresh card in any spaced-repetition app. `target_count`
    is plan-scaled by the caller (see app/services/billing.py's generation_target_count)
    -- defaults to the free tier's target so any caller that forgets to pass it explicitly
    fails toward the smaller number, not an unbounded one.

    `include_production_cards` additionally writes a production-direction sibling for
    every card generated, drilling the same material in the harder direction (shown the
    answer, must type the prompt back). It is an explicit opt-in rather than something
    inferred from the material, on purpose: "is this vocabulary?" is a real
    classification problem, getting it wrong doubles a student's daily review load for a
    chemistry deck that gains nothing from it, and an honest boolean the caller sets
    beats a heuristic that is quietly wrong a third of the time. The generation prompt is
    untouched -- the sibling is derived locally by swapping front/back, so enabling this
    costs no extra tokens and can't introduce a second, differently-worded version of the
    same fact."""
    text = await get_document_text(document)

    provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
    prompt = FLASHCARD_PROMPT.format(text=text[:MAX_MATERIAL_CHARS], target_count=target_count)

    raw = ""
    async for event in provider.stream_chat([ChatTurn(role="user", content=prompt)], model):
        if isinstance(event, TextDelta):
            raw += event.text

    rows: list[Flashcard] = []
    for item in parse_flashcards(raw):
        front = str(item["front"])[:2000]
        back = str(item["back"])[:2000]
        row = Flashcard(
            user_id=user_id,
            document_id=document.id,
            front=front,
            back=back,
            direction=DIRECTION_RECOGNITION,
        )
        db.add(row)
        rows.append(row)

        if include_production_cards:
            # front/back are swapped so that, in EVERY direction, front is the prompt
            # shown and back is the expected answer. Everything that reads a flashcard
            # without caring about direction (the .apkg and .pptx exports, the public
            # share page, weak-area rollups) then stays correct for free, and
            # grade_production_answer only ever has to compare against `back`.
            production = Flashcard(
                user_id=user_id,
                document_id=document.id,
                front=back,
                back=front,
                direction=DIRECTION_PRODUCTION,
            )
            db.add(production)
            rows.append(production)

    await db.flush()
    return rows


async def review_production_flashcard(
    db: AsyncSession, flashcard: Flashcard, typed_answer: str
) -> tuple[Flashcard, dict[str, Any]]:
    """Grades a typed answer against the card's real answer and feeds the result into the
    ORDINARY FSRS review path below -- the student never self-rates a production card.

    That's the point of the direction split: self-rating is fine for recognition, where
    only the student can see whether the word actually came to mind before the reveal,
    but on a production card the machine can see the answer they committed to, and
    grading it is strictly more honest than asking someone who just failed to produce a
    word whether they'd like to call that "Good". (Self-rating a production card is still
    accepted by the router for the case where the student disagrees with the grade --
    see app/routers/flashcards.py.)

    Returns the updated row plus a grading summary for immediate, specific feedback:
    what they typed, what was expected, the grade, and the rating it became."""
    grade, rating = grade_production_answer(typed_answer, flashcard.back)
    await review_flashcard(db, flashcard, rating)
    return flashcard, {
        "result": grade,
        "rating": rating,
        "answer": typed_answer,
        "expected": flashcard.back,
    }


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
