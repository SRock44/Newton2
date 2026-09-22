import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, PracticeExam, PracticeExamQuestion
from app.providers.base import ChatTurn, TextDelta
from app.providers.registry import get_provider
from app.services.documents import get_document_text

MAX_MATERIAL_CHARS = 12000
DEFAULT_NUM_QUESTIONS = 8

DIFFICULTIES = ("easy", "medium", "hard")

# How many of the user's most recent *completed* exams inform the next difficulty pick,
# and the score thresholds that shift it up or down a tier.
RECENT_EXAMS_FOR_ADAPTATION = 3
RAISE_DIFFICULTY_AT_SCORE = 0.8
LOWER_DIFFICULTY_AT_SCORE = 0.5

EXAM_PROMPT = """You are writing a {difficulty}-difficulty multiple-choice practice exam \
from course material, with exactly {num_questions} questions. Reply with ONLY a JSON \
object, no prose, in this exact shape:
{{
  "questions": [
    {{
      "question": "the question text",
      "choices": ["choice A", "choice B", "choice C", "choice D"],
      "correct_index": 0,
      "explanation": "one or two sentences on why the correct choice is right"
    }}
  ]
}}
Always exactly 4 choices per question, choices in a random order (don't always put the \
answer first), correct_index is the 0-based index of the right one. {difficulty_hint}

Material:
{text}
"""

# Used INSTEAD of EXAM_PROMPT when the student has no uploaded document and gave a bare
# topic instead (see generate_practice_exam below) -- same reasoning as
# flashcards.FLASHCARD_TOPIC_PROMPT: writing exam questions "about" a topic from the
# model's own knowledge is a naturally topic-flexible task already, so this stays a
# small, honest rewording of EXAM_PROMPT rather than a different kind of task. Same
# stated tradeoff too: not grounded in a fetched source, just the model's own knowledge
# of the topic -- acceptable because that's what a bare chatbot would do anyway, and
# Newton's value-add (adaptive difficulty tracked over real completed exams, scored and
# saved) is unaffected by where the question topics came from.
EXAM_TOPIC_PROMPT = """You are writing a {difficulty}-difficulty multiple-choice practice exam to \
test a student on a topic from scratch, using your own knowledge -- the student has not uploaded \
any document, so there is nothing to extract from; write the exam directly, with exactly \
{num_questions} questions covering the core of the topic. Reply with ONLY a JSON object, no prose, \
in this exact shape:
{{
  "questions": [
    {{
      "question": "the question text",
      "choices": ["choice A", "choice B", "choice C", "choice D"],
      "correct_index": 0,
      "explanation": "one or two sentences on why the correct choice is right"
    }}
  ]
}}
Always exactly 4 choices per question, choices in a random order (don't always put the \
answer first), correct_index is the 0-based index of the right one. {difficulty_hint}

Topic: {topic}
"""

_DIFFICULTY_HINTS = {
    "easy": "Keep questions to direct recall of clearly-stated facts and definitions.",
    "medium": "Mix direct recall with questions that require applying a concept, not just naming it.",
    "hard": "Favor questions that require applying, comparing, or reasoning through concepts, not just recalling a definition.",
}


def parse_exam_questions(raw: str) -> list[dict[str, Any]]:
    """Pure parsing, mirroring app.services.study_planner.parse_study_plan_items. Keeps
    only questions with exactly 4 choices and a correct_index that's actually in range —
    anything else is a malformed item the model produced, not a real question."""
    try:
        start = raw.index("{")
        end = raw.rindex("}") + 1
        data = json.loads(raw[start:end])
    except (ValueError, json.JSONDecodeError):
        return []

    questions = data.get("questions", [])
    if not isinstance(questions, list):
        return []

    valid = []
    for q in questions:
        if not isinstance(q, dict) or not q.get("question"):
            continue
        choices = q.get("choices")
        if not isinstance(choices, list) or len(choices) != 4:
            continue
        correct_index = q.get("correct_index")
        if not isinstance(correct_index, int) or not (0 <= correct_index < 4):
            continue
        valid.append(q)
    return valid


async def _next_difficulty(db: AsyncSession, user_id: uuid.UUID) -> str:
    recent = (
        await db.execute(
            select(PracticeExam.score)
            .where(PracticeExam.user_id == user_id, PracticeExam.score.is_not(None))
            .order_by(PracticeExam.completed_at.desc())
            .limit(RECENT_EXAMS_FOR_ADAPTATION)
        )
    ).scalars().all()
    if not recent:
        return "medium"

    average = sum(recent) / len(recent)
    if average >= RAISE_DIFFICULTY_AT_SCORE:
        return "hard"
    if average <= LOWER_DIFFICULTY_AT_SCORE:
        return "easy"
    return "medium"


async def generate_practice_exam(
    db: AsyncSession,
    user_id: uuid.UUID,
    document: Document | None,
    num_questions: int = DEFAULT_NUM_QUESTIONS,
    byok_anthropic_key: str | None = None,
    topic: str | None = None,
) -> PracticeExam:
    """Adaptive: difficulty is picked from the user's recent completed-exam scores
    before generating (see _next_difficulty), not fixed. Persists the exam and its
    questions (caller commits); an exam with zero valid questions in the model's
    response is still created (so the caller can see generation genuinely produced
    nothing, rather than silently vanishing), just with an empty questions list.

    `document` is None exactly on the bare-topic path (see `topic`) -- callers pass
    exactly one, never both, never neither (a ValueError if so -- a programming error,
    not a user-facing one). Passing `document` behaves completely unchanged from before
    `topic` existed. `topic` generates the exam directly from the model's own knowledge
    of the named topic, in this same single provider call (see EXAM_TOPIC_PROMPT) --
    exam.document_id is left None (nullable for exactly this) and exam.title becomes the
    topic string itself."""
    if document is None and not topic:
        raise ValueError("generate_practice_exam needs either a document or a topic.")

    if document is not None:
        text = await get_document_text(document)
        difficulty = await _next_difficulty(db, user_id)
        provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
        prompt = EXAM_PROMPT.format(
            difficulty=difficulty,
            num_questions=num_questions,
            difficulty_hint=_DIFFICULTY_HINTS[difficulty],
            text=text[:MAX_MATERIAL_CHARS],
        )
    else:
        difficulty = await _next_difficulty(db, user_id)
        provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
        prompt = EXAM_TOPIC_PROMPT.format(
            difficulty=difficulty,
            num_questions=num_questions,
            difficulty_hint=_DIFFICULTY_HINTS[difficulty],
            topic=topic,
        )

    raw = ""
    async for event in provider.stream_chat([ChatTurn(role="user", content=prompt)], model):
        if isinstance(event, TextDelta):
            raw += event.text

    exam = PracticeExam(
        user_id=user_id,
        document_id=document.id if document is not None else None,
        title=document.filename if document is not None else str(topic)[:500],
        difficulty=difficulty,
    )
    db.add(exam)
    await db.flush()

    for i, item in enumerate(parse_exam_questions(raw)):
        db.add(
            PracticeExamQuestion(
                exam_id=exam.id,
                question_index=i,
                question=str(item["question"])[:2000],
                choices=[str(c)[:500] for c in item["choices"]],
                correct_index=item["correct_index"],
                explanation=str(item.get("explanation"))[:1000] if item.get("explanation") else None,
            )
        )

    await db.flush()
    return exam


async def get_exam_questions(db: AsyncSession, exam_id: uuid.UUID) -> list[PracticeExamQuestion]:
    rows = (
        await db.execute(
            select(PracticeExamQuestion)
            .where(PracticeExamQuestion.exam_id == exam_id)
            .order_by(PracticeExamQuestion.question_index)
        )
    ).scalars().all()
    return list(rows)


async def submit_exam(
    db: AsyncSession, exam: PracticeExam, answers: dict[uuid.UUID, int]
) -> PracticeExam:
    """`answers` maps question_id -> chosen choice index. A question with no answer in
    the dict is graded as incorrect (not skipped/excluded) -- an unanswered question on
    a real exam is a wrong answer, not a non-event that shouldn't count against the score."""
    questions = await get_exam_questions(db, exam.id)
    if not questions:
        raise ValueError("This exam has no questions to grade.")

    correct_count = 0
    for question in questions:
        chosen = answers.get(question.id)
        question.student_answer_index = chosen
        question.is_correct = chosen is not None and chosen == question.correct_index
        if question.is_correct:
            correct_count += 1

    exam.score = correct_count / len(questions)
    exam.completed_at = datetime.now(timezone.utc)
    await db.flush()
    return exam
