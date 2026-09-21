"""Surfaces genuinely low-performing areas from REAL performance data (flashcard
review history + completed practice exam results) -- the actual data this app already
records but the Tutor never looks at. Grouped by source `Document` (the only "topic"
label that exists) rather than any invented topic-classification scheme; a card/
question with no source document is grouped under "general" so it isn't lost.
"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, Flashcard, FlashcardReviewLog, PracticeExam, PracticeExamQuestion

# Only the most recent few reviews decide whether a card is CURRENTLY weak -- an old
# rough patch on a card the student has since nailed shouldn't keep flagging it.
_RECENT_REVIEWS_PER_CARD = 3
# fsrs.Rating: 1=Again, 2=Hard, 3=Good, 4=Easy -- Again/Hard count toward "weak".
_WEAK_RATING_THRESHOLD = 2
_MAX_EXAMPLES_PER_GROUP = 5

_GENERAL_LABEL = "general"


@dataclass
class WeakArea:
    label: str
    weak_flashcards: list[str] = field(default_factory=list)
    missed_questions: list[str] = field(default_factory=list)
    # Real row identifiers, paired 1:1 (same order, same truncation) with the text lists
    # above -- what lets a caller actually SCOPE a review session to these exact items
    # instead of just displaying their text. `weak_flashcards[i]` is the front of the
    # card whose id is `weak_flashcard_ids[i]`, and likewise for the missed-questions pair.
    weak_flashcard_ids: list[uuid.UUID] = field(default_factory=list)
    missed_question_ids: list[uuid.UUID] = field(default_factory=list)
    # Which completed PracticeExam each entry in missed_questions/missed_question_ids
    # came from -- paired 1:1 with them the same way. Missed questions on one document
    # can span several separate completed exams, so knowing per-question exam ids is
    # what lets a caller pick "the one exam with the most missed questions here" instead
    # of just the document.
    missed_question_exam_ids: list[uuid.UUID] = field(default_factory=list)
    # The real grouping key this area was built from (None for the "general" bucket of
    # cards/questions with no source document) -- previously only used internally to look
    # up `label`, now surfaced so a caller can scope by it directly.
    document_id: uuid.UUID | None = None

    @property
    def weak_count(self) -> int:
        return len(self.weak_flashcards) + len(self.missed_questions)


async def get_weak_areas(db: AsyncSession, user_id: uuid.UUID) -> list[WeakArea]:
    """Real queries, no invented heuristics beyond the recency window/threshold above.
    Returns an empty list when there's simply not enough history yet (a new student) --
    that's a normal, unremarkable state, not an error."""
    cards = (await db.execute(select(Flashcard).where(Flashcard.user_id == user_id))).scalars().all()

    # (front text, card id) pairs, grouped by document -- kept as pairs (rather than two
    # parallel lists built separately) so slicing to _MAX_EXAMPLES_PER_GROUP later can
    # never let the text and id lists drift out of sync with each other.
    weak_by_doc: dict[uuid.UUID | None, list[tuple[str, uuid.UUID]]] = {}
    for card in cards:
        logs = (
            await db.execute(
                select(FlashcardReviewLog)
                .where(FlashcardReviewLog.flashcard_id == card.id)
                .order_by(FlashcardReviewLog.reviewed_at.desc())
                .limit(_RECENT_REVIEWS_PER_CARD)
            )
        ).scalars().all()
        if not logs:
            continue  # never reviewed -- no signal either way
        weak_count = sum(1 for log in logs if log.rating <= _WEAK_RATING_THRESHOLD)
        if weak_count > len(logs) / 2:
            weak_by_doc.setdefault(card.document_id, []).append((card.front, card.id))

    # (question text, question id, exam id) triples, grouped by document.
    missed_by_doc: dict[uuid.UUID | None, list[tuple[str, uuid.UUID, uuid.UUID]]] = {}
    exams = (
        await db.execute(
            select(PracticeExam).where(
                PracticeExam.user_id == user_id, PracticeExam.completed_at.isnot(None)
            )
        )
    ).scalars().all()
    for exam in exams:
        questions = (
            await db.execute(
                select(PracticeExamQuestion).where(
                    PracticeExamQuestion.exam_id == exam.id,
                    PracticeExamQuestion.is_correct.is_(False),
                )
            )
        ).scalars().all()
        for q in questions:
            missed_by_doc.setdefault(exam.document_id, []).append((q.question, q.id, exam.id))

    doc_ids = {key for key in list(weak_by_doc) + list(missed_by_doc) if key is not None}
    filenames: dict[uuid.UUID, str] = {}
    if doc_ids:
        docs = (await db.execute(select(Document).where(Document.id.in_(doc_ids)))).scalars().all()
        filenames = {d.id: d.filename for d in docs}

    areas = []
    for key in set(weak_by_doc) | set(missed_by_doc):
        label = filenames.get(key, _GENERAL_LABEL) if key is not None else _GENERAL_LABEL
        weak_pairs = weak_by_doc.get(key, [])[:_MAX_EXAMPLES_PER_GROUP]
        missed_triples = missed_by_doc.get(key, [])[:_MAX_EXAMPLES_PER_GROUP]
        areas.append(
            WeakArea(
                label=label,
                weak_flashcards=[front for front, _card_id in weak_pairs],
                missed_questions=[text for text, _q_id, _exam_id in missed_triples],
                weak_flashcard_ids=[card_id for _front, card_id in weak_pairs],
                missed_question_ids=[q_id for _text, q_id, _exam_id in missed_triples],
                missed_question_exam_ids=[exam_id for _text, _q_id, exam_id in missed_triples],
                document_id=key,
            )
        )
    areas.sort(key=lambda a: a.weak_count, reverse=True)
    return areas


def format_weak_areas(areas: list[WeakArea]) -> str:
    """Turns the query result into the string handed back to the model -- concrete
    example questions/fronts included, not just counts, so the model has real material
    to reason about (what the underlying concept actually is) and act on."""
    if not areas:
        return (
            "Not enough review/exam history yet to tell what this student is actually "
            "struggling with -- no flashcard reviews or completed practice exams to "
            "analyze. Don't guess at weak areas; suggest they review some flashcards "
            "or take a practice exam first so there's real data to look at."
        )

    lines = ["Based on real review/exam performance, here's what the student is actually struggling with:"]
    for area in areas:
        parts = []
        if area.weak_flashcards:
            examples = "; ".join(f'"{f}"' for f in area.weak_flashcards)
            parts.append(
                f"{len(area.weak_flashcards)} flashcard(s) trending Again/Hard lately "
                f"(e.g. {examples})"
            )
        if area.missed_questions:
            examples = "; ".join(f'"{q}"' for q in area.missed_questions)
            parts.append(f"{len(area.missed_questions)} missed practice question(s) (e.g. {examples})")
        lines.append(f"- {area.label}: " + "; ".join(parts))
    lines.append(
        "\nReason about what these have in common (the underlying concept), and use it "
        "to suggest a targeted review or bias a follow-up flashcard/practice-exam "
        "generation toward this material -- don't just repeat the raw list back."
    )
    return "\n".join(lines)
