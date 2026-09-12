import base64
import json as json_
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import Document, PracticeExam, PracticeExamQuestion, User
from app.services import documents as documents_service
from app.services import practice_exams as practice_exams_service
from app.services.practice_exams import (
    _next_difficulty,
    generate_practice_exam,
    get_exam_questions,
    parse_exam_questions,
    submit_exam,
)
from tests.fakes import ScriptedToolCallingProvider

# ---------------------------------------------------------------------------
# Pure parsing tests — no DB, no network.
# ---------------------------------------------------------------------------

_VALID_QUESTION = {
    "question": "What is 2+2?",
    "choices": ["3", "4", "5", "6"],
    "correct_index": 1,
    "explanation": "2+2=4",
}


def test_parse_exam_questions_extracts_a_valid_question():
    raw = 'Here:\n{"questions": [' + str(_VALID_QUESTION).replace("'", '"') + "]}"
    questions = parse_exam_questions(raw)
    assert len(questions) == 1
    assert questions[0]["correct_index"] == 1


def test_parse_exam_questions_rejects_wrong_choice_count():
    bad = {**_VALID_QUESTION, "choices": ["only", "three", "here"]}
    raw = '{"questions": [' + str(bad).replace("'", '"') + "]}"
    assert parse_exam_questions(raw) == []


def test_parse_exam_questions_rejects_out_of_range_correct_index():
    bad = {**_VALID_QUESTION, "correct_index": 4}
    raw = '{"questions": [' + str(bad).replace("'", '"') + "]}"
    assert parse_exam_questions(raw) == []


def test_parse_exam_questions_rejects_non_int_correct_index():
    bad = {**_VALID_QUESTION, "correct_index": "1"}
    raw = '{"questions": [' + str(bad).replace("'", '"') + "]}"
    assert parse_exam_questions(raw) == []


def test_parse_exam_questions_filters_questions_missing_the_question_text():
    bad = {**_VALID_QUESTION}
    del bad["question"]
    raw = '{"questions": [' + str(bad).replace("'", '"') + "]}"
    assert parse_exam_questions(raw) == []


def test_parse_exam_questions_returns_empty_list_for_unparseable_text():
    assert parse_exam_questions("[echo/no-provider-configured] you said: whatever") == []


def test_parse_exam_questions_handles_non_list_questions_field():
    assert parse_exam_questions('{"questions": "nope"}') == []


# ---------------------------------------------------------------------------
# Adaptive difficulty selection — real DB rows, no network.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_user(db_session):
    user = User(keycloak_sub=f"test-practice-exams-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    yield user
    await db_session.execute(delete(PracticeExamQuestion).where(PracticeExamQuestion.exam_id.in_(
        select(PracticeExam.id).where(PracticeExam.user_id == user.id)
    )))
    await db_session.execute(delete(PracticeExam).where(PracticeExam.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_next_difficulty_defaults_to_medium_with_no_history(db_session, throwaway_user):
    assert await _next_difficulty(db_session, throwaway_user.id) == "medium"


async def test_next_difficulty_raises_after_a_high_score(db_session, throwaway_user):
    exam = PracticeExam(
        user_id=throwaway_user.id, title="t", difficulty="medium", score=0.9,
        completed_at=datetime.now(timezone.utc),
    )
    db_session.add(exam)
    await db_session.commit()

    assert await _next_difficulty(db_session, throwaway_user.id) == "hard"


async def test_next_difficulty_lowers_after_a_low_score(db_session, throwaway_user):
    exam = PracticeExam(
        user_id=throwaway_user.id, title="t", difficulty="medium", score=0.3,
        completed_at=datetime.now(timezone.utc),
    )
    db_session.add(exam)
    await db_session.commit()

    assert await _next_difficulty(db_session, throwaway_user.id) == "easy"


async def test_next_difficulty_ignores_uncompleted_exams(db_session, throwaway_user):
    # score is None (never submitted) — must not count toward the average at all
    exam = PracticeExam(user_id=throwaway_user.id, title="t", difficulty="medium")
    db_session.add(exam)
    await db_session.commit()

    assert await _next_difficulty(db_session, throwaway_user.id) == "medium"


# ---------------------------------------------------------------------------
# generate_practice_exam / submit_exam orchestration — real DB rows, scripted provider.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_document(db_session):
    user = User(keycloak_sub=f"test-practice-exams-doc-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    document = Document(user_id=user.id, filename="notes.txt", mime_type="text/plain", minio_key="unused")
    db_session.add(document)
    await db_session.flush()
    await db_session.commit()

    yield user, document

    await db_session.execute(delete(PracticeExamQuestion).where(PracticeExamQuestion.exam_id.in_(
        select(PracticeExam.id).where(PracticeExam.user_id == user.id)
    )))
    await db_session.execute(delete(PracticeExam).where(PracticeExam.user_id == user.id))
    await db_session.execute(delete(Document).where(Document.id == document.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def _fake_get_document_text(_document) -> str:
    return "The mitochondria is the powerhouse of the cell."


async def test_generate_practice_exam_creates_exam_and_questions(
    throwaway_document, db_session, monkeypatch
):
    user, document = throwaway_document
    fake = ScriptedToolCallingProvider(
        [
            [
                '{"questions": [',
                '{"question": "What is the powerhouse of the cell?", '
                '"choices": ["Nucleus", "Mitochondria", "Ribosome", "Golgi"], '
                '"correct_index": 1, "explanation": "It produces ATP."}',
                "]}",
            ]
        ]
    )
    monkeypatch.setattr(practice_exams_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(practice_exams_service, "get_document_text", _fake_get_document_text)

    exam = await generate_practice_exam(db_session, user.id, document, num_questions=1)
    await db_session.commit()

    assert exam.user_id == user.id
    assert exam.document_id == document.id
    assert exam.difficulty == "medium"
    assert exam.score is None
    assert exam.completed_at is None

    questions = await get_exam_questions(db_session, exam.id)
    assert len(questions) == 1
    assert questions[0].correct_index == 1
    assert len(questions[0].choices) == 4


async def test_generate_practice_exam_creates_no_questions_for_unparseable_response(
    throwaway_document, db_session, monkeypatch
):
    user, document = throwaway_document
    fake = ScriptedToolCallingProvider([["Not JSON, sorry."]])
    monkeypatch.setattr(practice_exams_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(practice_exams_service, "get_document_text", _fake_get_document_text)

    exam = await generate_practice_exam(db_session, user.id, document, num_questions=1)
    await db_session.commit()

    questions = await get_exam_questions(db_session, exam.id)
    assert questions == []


async def test_submit_exam_grades_correctly_and_computes_score(db_session, throwaway_user):
    exam = PracticeExam(user_id=throwaway_user.id, title="t", difficulty="medium")
    db_session.add(exam)
    await db_session.flush()
    q1 = PracticeExamQuestion(
        exam_id=exam.id, question_index=0, question="Q1", choices=["a", "b", "c", "d"], correct_index=1
    )
    q2 = PracticeExamQuestion(
        exam_id=exam.id, question_index=1, question="Q2", choices=["a", "b", "c", "d"], correct_index=2
    )
    db_session.add_all([q1, q2])
    await db_session.commit()

    updated = await submit_exam(db_session, exam, {q1.id: 1, q2.id: 0})  # q1 right, q2 wrong
    await db_session.commit()

    assert updated.score == 0.5
    assert updated.completed_at is not None
    await db_session.refresh(q1)
    await db_session.refresh(q2)
    assert q1.is_correct is True
    assert q2.is_correct is False
    assert q2.student_answer_index == 0


async def test_submit_exam_grades_an_unanswered_question_as_incorrect(db_session, throwaway_user):
    exam = PracticeExam(user_id=throwaway_user.id, title="t", difficulty="medium")
    db_session.add(exam)
    await db_session.flush()
    q1 = PracticeExamQuestion(
        exam_id=exam.id, question_index=0, question="Q1", choices=["a", "b", "c", "d"], correct_index=1
    )
    db_session.add(q1)
    await db_session.commit()

    updated = await submit_exam(db_session, exam, {})  # no answer given
    await db_session.commit()

    assert updated.score == 0.0
    await db_session.refresh(q1)
    assert q1.is_correct is False
    assert q1.student_answer_index is None


async def test_submit_exam_raises_for_an_exam_with_no_questions(db_session, throwaway_user):
    exam = PracticeExam(user_id=throwaway_user.id, title="t", difficulty="medium")
    db_session.add(exam)
    await db_session.commit()

    with pytest.raises(ValueError):
        await submit_exam(db_session, exam, {})


async def test_deleting_a_document_does_not_destroy_its_practice_exams(throwaway_document, db_session):
    user, document = throwaway_document
    exam = PracticeExam(user_id=user.id, document_id=document.id, title="t", difficulty="medium")
    db_session.add(exam)
    await db_session.commit()

    await documents_service.delete_document(db_session, document)

    await db_session.refresh(exam)
    assert exam.document_id is None
    assert exam.title == "t"


# ---------------------------------------------------------------------------
# Router-level tests — real HTTP against the live server.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def uploaded_document(http_client, auth_headers, db_session):
    content = b"Photosynthesis converts sunlight into chemical energy in plants."
    resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("bio-notes.txt", content, "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    document_id = uuid.UUID(resp.json()["id"])

    yield document_id

    await db_session.execute(
        delete(PracticeExamQuestion).where(
            PracticeExamQuestion.exam_id.in_(
                select(PracticeExam.id).where(PracticeExam.document_id == document_id)
            )
        )
    )
    await db_session.execute(delete(PracticeExam).where(PracticeExam.document_id == document_id))
    document = await db_session.get(Document, document_id)
    if document is not None:
        await documents_service.delete_document(db_session, document)


async def test_generate_requires_auth(http_client):
    resp = await http_client.post(f"/practice-exams/generate/{uuid.uuid4()}")
    assert resp.status_code == 401


async def test_generate_404s_for_a_nonexistent_document(http_client, auth_headers):
    resp = await http_client.post(f"/practice-exams/generate/{uuid.uuid4()}", headers=auth_headers)
    assert resp.status_code == 404


async def test_generate_returns_an_exam_that_shows_up_in_list(uploaded_document, http_client, auth_headers):
    resp = await http_client.post(
        f"/practice-exams/generate/{uploaded_document}", headers=auth_headers, params={"num_questions": 2}
    )
    assert resp.status_code == 200, resp.text
    exam_id = resp.json()["id"]

    list_resp = await http_client.get("/practice-exams", headers=auth_headers)
    assert list_resp.status_code == 200
    assert exam_id in {e["id"] for e in list_resp.json()}


async def _owner_from_auth_headers(db_session, auth_headers: dict) -> User:
    """Resolves the real User row auth_headers' bearer token authenticates as, by
    decoding its `sub` claim (no verification needed — test-only convenience) and
    looking it up. Lets a test build fixture rows directly under student1 without going
    through the (Echo-provider) generation endpoint."""
    token = auth_headers["Authorization"].removeprefix("Bearer ")
    payload = token.split(".")[1]
    padded = payload + "=" * (-len(payload) % 4)
    sub = json_.loads(base64.urlsafe_b64decode(padded))["sub"]
    return (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalar_one()


@pytest_asyncio.fixture
async def exam_with_one_question(db_session, auth_headers):
    owner = await _owner_from_auth_headers(db_session, auth_headers)
    exam = PracticeExam(user_id=owner.id, title="t", difficulty="medium")
    db_session.add(exam)
    await db_session.flush()
    question = PracticeExamQuestion(
        exam_id=exam.id, question_index=0, question="Q", choices=["a", "b", "c", "d"], correct_index=2
    )
    db_session.add(question)
    await db_session.commit()

    yield exam, question

    await db_session.execute(delete(PracticeExamQuestion).where(PracticeExamQuestion.exam_id == exam.id))
    await db_session.execute(delete(PracticeExam).where(PracticeExam.id == exam.id))
    await db_session.commit()


async def test_get_exam_never_reveals_answers_before_completion(
    exam_with_one_question, http_client, auth_headers
):
    exam, _question = exam_with_one_question

    resp = await http_client.get(f"/practice-exams/{exam.id}", headers=auth_headers)
    assert resp.status_code == 200
    returned_question = resp.json()["questions"][0]
    assert "correct_index" not in returned_question
    assert "explanation" not in returned_question


async def test_submit_reveals_answers_and_grades(exam_with_one_question, http_client, auth_headers):
    exam, question = exam_with_one_question

    resp = await http_client.post(
        f"/practice-exams/{exam.id}/submit",
        headers=auth_headers,
        json={"answers": {str(question.id): 2}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["score"] == 1.0
    assert body["completed_at"] is not None
    assert body["questions"][0]["is_correct"] is True
    assert body["questions"][0]["correct_index"] == 2

    # Submitting a second time must be rejected, not silently re-graded.
    resp2 = await http_client.post(
        f"/practice-exams/{exam.id}/submit",
        headers=auth_headers,
        json={"answers": {str(question.id): 2}},
    )
    assert resp2.status_code == 409


async def test_delete_exam_removes_it(uploaded_document, http_client, auth_headers, db_session):
    document = await db_session.get(Document, uploaded_document)
    exam = PracticeExam(user_id=document.user_id, document_id=document.id, title="t", difficulty="medium")
    db_session.add(exam)
    await db_session.commit()

    resp = await http_client.delete(f"/practice-exams/{exam.id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"status": "deleted"}
    assert (
        await db_session.execute(select(PracticeExam).where(PracticeExam.id == exam.id))
    ).scalar_one_or_none() is None


async def test_delete_exam_404s_for_another_users_exam(throwaway_document, http_client, auth_headers, db_session):
    _, document = throwaway_document
    exam = PracticeExam(user_id=document.user_id, document_id=document.id, title="t", difficulty="medium")
    db_session.add(exam)
    await db_session.commit()

    resp = await http_client.delete(f"/practice-exams/{exam.id}", headers=auth_headers)
    assert resp.status_code == 404
    assert await db_session.get(PracticeExam, exam.id) is not None
