import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import (
    Document,
    Flashcard,
    FlashcardReviewLog,
    PracticeExam,
    PracticeExamQuestion,
    StudyPlanItem,
    User,
)
from app.services import flashcards as flashcards_service
from app.services import practice_exams as practice_exams_service
from app.services import study_planner
from app.tools.registry import run_tool
from app.tools.study_session import StudySessionTool, _resolve_document
from tests.fakes import ScriptedToolCallingProvider


@pytest_asyncio.fixture
async def two_documents(db_session):
    user = User(keycloak_sub=f"test-study-session-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    # Explicit, distinct timestamps rather than relying on insertion order: Postgres'
    # now() is transaction time, so two rows inserted in the same transaction (as these
    # are) would otherwise get byte-identical created_at values, making "most recent"
    # genuinely undefined between them.
    now = datetime.now(timezone.utc)
    older = Document(
        user_id=user.id, filename="old-notes.txt", mime_type="text/plain", minio_key="unused",
        created_at=now - timedelta(days=1),
    )
    db_session.add(older)
    await db_session.flush()

    newer = Document(
        user_id=user.id, filename="biology-notes.txt", mime_type="text/plain", minio_key="unused",
        created_at=now,
    )
    db_session.add(newer)
    await db_session.flush()
    await db_session.commit()

    yield user, older, newer

    await db_session.execute(delete(FlashcardReviewLog).where(FlashcardReviewLog.user_id == user.id))
    await db_session.execute(delete(Flashcard).where(Flashcard.user_id == user.id))
    await db_session.execute(
        delete(PracticeExamQuestion).where(
            PracticeExamQuestion.exam_id.in_(select(PracticeExam.id).where(PracticeExam.user_id == user.id))
        )
    )
    await db_session.execute(delete(PracticeExam).where(PracticeExam.user_id == user.id))
    await db_session.execute(delete(StudyPlanItem).where(StudyPlanItem.user_id == user.id))
    await db_session.execute(delete(Document).where(Document.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


# ---------------------------------------------------------------------------
# _resolve_document — pure DB lookups, no network.
# ---------------------------------------------------------------------------


async def test_resolve_document_defaults_to_most_recently_uploaded(db_session, two_documents):
    user, _older, newer = two_documents
    resolved = await _resolve_document(db_session, user.id, None)
    assert resolved.id == newer.id


async def test_resolve_document_matches_a_filename_substring(db_session, two_documents):
    user, older, _newer = two_documents
    resolved = await _resolve_document(db_session, user.id, "old-notes")
    assert resolved.id == older.id


async def test_resolve_document_returns_none_for_no_match(db_session, two_documents):
    user, _older, _newer = two_documents
    assert await _resolve_document(db_session, user.id, "nonexistent-file") is None


async def test_resolve_document_is_scoped_to_the_given_user(db_session, two_documents):
    _user, _older, _newer = two_documents
    other_user_id = uuid.uuid4()
    assert await _resolve_document(db_session, other_user_id, None) is None


# ---------------------------------------------------------------------------
# Full run() — real generation logic, scripted providers (each real service module's
# own get_provider is mocked, same as their individual test files), real concurrent
# writes across three isolated DB sessions.
# ---------------------------------------------------------------------------


def _study_plan_script():
    return ScriptedToolCallingProvider(
        [['{"items": [{"title": "Reading response", "due_date": null, '
          '"due_date_text": "Week 3", "notes": null}]}']]
    )


def _flashcards_script():
    return ScriptedToolCallingProvider(
        [['{"cards": [{"front": "What is ATP?", "back": "Adenosine triphosphate"}]}']]
    )


def _exam_script():
    return ScriptedToolCallingProvider(
        [
            [
                '{"questions": [{"question": "What is ATP?", '
                '"choices": ["A sugar", "Adenosine triphosphate", "A protein", "A lipid"], '
                '"correct_index": 1, "explanation": "ATP is the energy currency of cells."}]}'
            ]
        ]
    )


async def _fake_get_document_text(_document) -> str:
    return "ATP (adenosine triphosphate) is the energy currency of the cell."


async def test_run_generates_all_three_artifacts_concurrently(two_documents, db_session, monkeypatch):
    user, _older, newer = two_documents

    monkeypatch.setattr(study_planner, "get_provider", lambda **kwargs: (_study_plan_script(), "fake-model"))
    monkeypatch.setattr(study_planner, "get_document_text", _fake_get_document_text)
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (_flashcards_script(), "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)
    monkeypatch.setattr(
        practice_exams_service, "get_provider", lambda **kwargs: (_exam_script(), "fake-model")
    )
    monkeypatch.setattr(practice_exams_service, "get_document_text", _fake_get_document_text)

    tool = StudySessionTool()
    result = await tool.run(document_filename="biology", user_id=str(user.id))

    assert "biology-notes.txt" in result
    assert "1 study plan item(s)" in result
    assert "1 flashcard(s)" in result
    assert "1-question practice exam" in result

    plan_items = (
        await db_session.execute(select(StudyPlanItem).where(StudyPlanItem.document_id == newer.id))
    ).scalars().all()
    assert len(plan_items) == 1

    cards = (await db_session.execute(select(Flashcard).where(Flashcard.document_id == newer.id))).scalars().all()
    assert len(cards) == 1

    exams = (await db_session.execute(select(PracticeExam).where(PracticeExam.document_id == newer.id))).scalars().all()
    assert len(exams) == 1


async def test_run_returns_a_clear_error_with_no_matching_document(two_documents):
    user, _older, _newer = two_documents
    tool = StudySessionTool()
    result = await tool.run(document_filename="does-not-exist", user_id=str(user.id))
    assert result.startswith("Error:")
    assert "does-not-exist" in result


async def test_run_returns_a_clear_error_with_no_user_context():
    tool = StudySessionTool()
    result = await tool.run(document_filename="anything", user_id=None)
    assert result.startswith("Error:")


async def test_run_returns_a_clear_error_with_no_documents_at_all(db_session):
    user = User(keycloak_sub=f"test-study-session-empty-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.commit()
    try:
        tool = StudySessionTool()
        result = await tool.run(user_id=str(user.id))
        assert result.startswith("Error:")
    finally:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


# ---------------------------------------------------------------------------
# Registry-level: proves user_id threading actually reaches this tool through the real
# run_tool() mechanism, not just when called directly.
# ---------------------------------------------------------------------------


async def test_run_tool_threads_user_id_through_to_study_session(two_documents, monkeypatch):
    user, _older, _newer = two_documents

    monkeypatch.setattr(study_planner, "get_provider", lambda **kwargs: (_study_plan_script(), "fake-model"))
    monkeypatch.setattr(study_planner, "get_document_text", _fake_get_document_text)
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (_flashcards_script(), "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)
    monkeypatch.setattr(
        practice_exams_service, "get_provider", lambda **kwargs: (_exam_script(), "fake-model")
    )
    monkeypatch.setattr(practice_exams_service, "get_document_text", _fake_get_document_text)

    result = await run_tool(
        "start_study_session", {"document_filename": "biology"}, session_id="unused", user_id=str(user.id)
    )
    assert "biology-notes.txt" in result

    # a tool that doesn't declare user_id must not receive it as an unexpected kwarg
    calc_result = await run_tool("calculator", {"expression": "3 * 3"}, user_id=str(user.id))
    assert not calc_result.startswith("Error: bad arguments")
