import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.db.models import Document, PracticeExam, PracticeExamQuestion
from app.services.practice_exams import (
    DEFAULT_NUM_QUESTIONS,
    generate_practice_exam,
    get_exam_questions,
    submit_exam,
)
from app.services.users import get_or_create_user

router = APIRouter(prefix="/practice-exams", tags=["practice-exams"])


def _serialize_question(q: PracticeExamQuestion, reveal: bool) -> dict:
    base = {
        "id": str(q.id),
        "question_index": q.question_index,
        "question": q.question,
        "choices": q.choices,
    }
    # Never send the answer key (or the student's own prior graded answer) until the
    # exam is actually completed -- otherwise the frontend would have the answers in
    # hand before the student ever submits anything.
    if reveal:
        base["correct_index"] = q.correct_index
        base["explanation"] = q.explanation
        base["student_answer_index"] = q.student_answer_index
        base["is_correct"] = q.is_correct
    return base


def _serialize_exam(exam: PracticeExam, questions: list[PracticeExamQuestion]) -> dict:
    reveal = exam.completed_at is not None
    return {
        "id": str(exam.id),
        "document_id": str(exam.document_id) if exam.document_id else None,
        "title": exam.title,
        "difficulty": exam.difficulty,
        "score": exam.score,
        "created_at": exam.created_at.isoformat(),
        "completed_at": exam.completed_at.isoformat() if exam.completed_at else None,
        "questions": [_serialize_question(q, reveal) for q in questions],
    }


@router.post("/generate/{document_id}")
async def generate(
    document_id: uuid.UUID,
    num_questions: int = Query(DEFAULT_NUM_QUESTIONS, ge=1, le=25),
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    document = await db.get(Document, document_id)
    if document is None or document.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    exam = await generate_practice_exam(db, user.id, document, num_questions=num_questions)
    await db.commit()
    questions = await get_exam_questions(db, exam.id)
    return _serialize_exam(exam, questions)


@router.get("")
async def list_exams(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    rows = (
        (
            await db.execute(
                select(PracticeExam)
                .where(PracticeExam.user_id == user.id)
                .order_by(PracticeExam.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(exam.id),
            "document_id": str(exam.document_id) if exam.document_id else None,
            "title": exam.title,
            "difficulty": exam.difficulty,
            "score": exam.score,
            "created_at": exam.created_at.isoformat(),
            "completed_at": exam.completed_at.isoformat() if exam.completed_at else None,
        }
        for exam in rows
    ]


async def _get_owned_exam(db: AsyncSession, exam_id: uuid.UUID, user_id: uuid.UUID) -> PracticeExam:
    exam = await db.get(PracticeExam, exam_id)
    if exam is None or exam.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Practice exam not found")
    return exam


@router.get("/{exam_id}")
async def get_exam(
    exam_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    exam = await _get_owned_exam(db, exam_id, user.id)
    questions = await get_exam_questions(db, exam.id)
    return _serialize_exam(exam, questions)


class SubmitRequest(BaseModel):
    answers: dict[str, int]  # question_id (str) -> chosen choice index


@router.post("/{exam_id}/submit")
async def submit(
    exam_id: uuid.UUID,
    body: SubmitRequest,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    exam = await _get_owned_exam(db, exam_id, user.id)
    if exam.completed_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This exam was already submitted.")

    try:
        answers = {uuid.UUID(k): v for k, v in body.answers.items()}
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid question id.") from exc

    try:
        exam = await submit_exam(db, exam, answers)
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    await db.commit()

    questions = await get_exam_questions(db, exam.id)
    return _serialize_exam(exam, questions)


@router.delete("/{exam_id}")
async def delete_exam(
    exam_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    exam = await _get_owned_exam(db, exam_id, user.id)

    await db.delete(exam)
    await db.commit()
    return {"status": "deleted"}
