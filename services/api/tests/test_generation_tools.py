"""Covers the three standalone chat-callable generation tools that fill the gap where
a plain chat request ("make me some flashcards", "quiz me", "build a study plan") had
no tool to call at all -- the model would just write flashcard/quiz/plan-shaped text
directly into its reply instead of actually creating anything, since only the Pro-gated
composite start_study_session tool (see test_study_session_tool.py) and the document-
scoped HTTP endpoints (app/routers/flashcards.py etc., triggered by a UI button, not
chat) could do real generation. These three are free for every user -- see each tool's
own docstring."""

import uuid

import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import Document, Flashcard, PracticeExam, PracticeExamQuestion, StudyPlanItem, User
from app.services import flashcards as flashcards_service
from app.services import practice_exams as practice_exams_service
from app.services import study_planner
from app.tools.flashcard_generation import FlashcardGenerationTool
from app.tools.practice_exam_generation import PracticeExamGenerationTool
from app.tools.registry import get_tool_specs, run_tool
from app.tools.study_plan_generation import StudyPlanGenerationTool
from tests.fakes import ScriptedToolCallingProvider


@pytest_asyncio.fixture
async def free_user_with_document(db_session):
    user = User(keycloak_sub=f"test-gen-tools-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.flush()

    document = Document(
        user_id=user.id, filename="biology-notes.txt", mime_type="text/plain", minio_key="unused"
    )
    db_session.add(document)
    await db_session.commit()

    yield user, document

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


async def _fake_get_document_text(_document) -> str:
    return "ATP (adenosine triphosphate) is the energy currency of the cell."


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


def _study_plan_script():
    return ScriptedToolCallingProvider(
        [['{"items": [{"title": "Reading response", "due_date": null, '
          '"due_date_text": "Week 3", "notes": null}]}']]
    )


async def test_all_three_tools_are_registered_and_free_tier_reachable():
    names = {t.name for t in get_tool_specs()}
    assert {"generate_flashcards", "generate_practice_exam", "generate_study_plan"} <= names


# ---------------------------------------------------------------------------
# generate_flashcards
# ---------------------------------------------------------------------------


async def test_generate_flashcards_creates_real_persisted_cards(free_user_with_document, db_session, monkeypatch):
    user, document = free_user_with_document
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (_flashcards_script(), "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

    result = await FlashcardGenerationTool().run(document_filename="biology", user_id=str(user.id))

    assert "1 flashcard(s)" in result
    assert "biology-notes.txt" in result
    cards = (await db_session.execute(select(Flashcard).where(Flashcard.document_id == document.id))).scalars().all()
    assert len(cards) == 1
    assert cards[0].front == "What is ATP?"


async def test_generate_flashcards_works_for_a_free_plan_user(free_user_with_document, monkeypatch):
    """The point of this tool existing: unlike start_study_session, this is NOT
    Pro-gated -- free users keep every individual generation feature, just not the
    one-click all-three-at-once orchestration."""
    user, _document = free_user_with_document
    assert user.plan == "free"
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (_flashcards_script(), "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

    result = await FlashcardGenerationTool().run(user_id=str(user.id))
    assert not result.startswith("Error:")
    assert "flashcard" in result.lower()


async def test_generate_flashcards_tool_can_add_production_siblings(
    free_user_with_document, db_session, monkeypatch
):
    """The chat path into the recognition/production split. Off by default (the test
    above already pins that a plain call makes exactly one card per fact); on request it
    writes a reversed, type-the-term sibling alongside each card."""
    user, document = free_user_with_document
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (_flashcards_script(), "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

    result = await FlashcardGenerationTool().run(
        document_filename="biology", include_production=True, user_id=str(user.id)
    )

    assert "2 flashcard(s)" in result
    cards = (
        await db_session.execute(select(Flashcard).where(Flashcard.document_id == document.id))
    ).scalars().all()
    assert {c.direction for c in cards} == {"recognition", "production"}
    production = next(c for c in cards if c.direction == "production")
    recognition = next(c for c in cards if c.direction == "recognition")
    assert production.front == recognition.back
    assert production.back == recognition.front


async def test_generate_flashcards_targets_the_free_tier_count_by_default(
    free_user_with_document, monkeypatch
):
    """Regression test: generation used to have no target count at all ("produce as
    many as the material supports"), which in practice often meant just one or two
    cards -- now free users get a real target of 5, Pro users 15 (see
    billing_service.generation_target_count)."""
    user, _document = free_user_with_document
    fake = _flashcards_script()
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

    await FlashcardGenerationTool().run(user_id=str(user.id))

    prompt = fake.calls_seen[0]["messages"][0].content
    assert "around 5 good cards" in prompt


async def test_generate_flashcards_targets_the_pro_tier_count(db_session, monkeypatch):
    user = User(keycloak_sub=f"test-gen-flashcards-pro-{uuid.uuid4()}", plan="pro")
    db_session.add(user)
    await db_session.flush()  # populates user.id before the Document below references it
    document = Document(user_id=user.id, filename="notes.txt", mime_type="text/plain", minio_key="unused")
    db_session.add(document)
    await db_session.commit()
    try:
        fake = _flashcards_script()
        monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
        monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

        await FlashcardGenerationTool().run(user_id=str(user.id))

        prompt = fake.calls_seen[0]["messages"][0].content
        assert "around 15 good cards" in prompt
    finally:
        await db_session.execute(delete(Flashcard).where(Flashcard.user_id == user.id))
        await db_session.execute(delete(Document).where(Document.id == document.id))
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


async def test_generate_flashcards_clear_error_with_no_matching_document(free_user_with_document):
    user, _document = free_user_with_document
    result = await FlashcardGenerationTool().run(document_filename="does-not-exist", user_id=str(user.id))
    assert result.startswith("Error:")
    assert "does-not-exist" in result


async def test_generate_flashcards_clear_error_with_no_user():
    result = await FlashcardGenerationTool().run(user_id=None)
    assert result.startswith("Error:")


# ---------------------------------------------------------------------------
# generate_practice_exam
# ---------------------------------------------------------------------------


async def test_generate_practice_exam_creates_a_real_persisted_exam(
    free_user_with_document, db_session, monkeypatch
):
    user, document = free_user_with_document
    monkeypatch.setattr(
        practice_exams_service, "get_provider", lambda **kwargs: (_exam_script(), "fake-model")
    )
    monkeypatch.setattr(practice_exams_service, "get_document_text", _fake_get_document_text)

    result = await PracticeExamGenerationTool().run(document_filename="biology", user_id=str(user.id))

    assert "1-question practice exam" in result
    exams = (
        await db_session.execute(select(PracticeExam).where(PracticeExam.document_id == document.id))
    ).scalars().all()
    assert len(exams) == 1


async def test_generate_practice_exam_targets_the_free_tier_count_by_default(
    free_user_with_document, monkeypatch
):
    user, _document = free_user_with_document
    fake = _exam_script()
    monkeypatch.setattr(practice_exams_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(practice_exams_service, "get_document_text", _fake_get_document_text)

    await PracticeExamGenerationTool().run(user_id=str(user.id))

    prompt = fake.calls_seen[0]["messages"][0].content
    assert "exactly 5 questions" in prompt


async def test_generate_practice_exam_targets_the_pro_tier_count(db_session, monkeypatch):
    user = User(keycloak_sub=f"test-gen-exam-pro-{uuid.uuid4()}", plan="pro")
    db_session.add(user)
    await db_session.flush()  # populates user.id before the Document below references it
    document = Document(user_id=user.id, filename="notes.txt", mime_type="text/plain", minio_key="unused")
    db_session.add(document)
    await db_session.commit()
    try:
        fake = _exam_script()
        monkeypatch.setattr(practice_exams_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
        monkeypatch.setattr(practice_exams_service, "get_document_text", _fake_get_document_text)

        await PracticeExamGenerationTool().run(user_id=str(user.id))

        prompt = fake.calls_seen[0]["messages"][0].content
        assert "exactly 15 questions" in prompt
    finally:
        await db_session.execute(
            delete(PracticeExamQuestion).where(
                PracticeExamQuestion.exam_id.in_(select(PracticeExam.id).where(PracticeExam.user_id == user.id))
            )
        )
        await db_session.execute(delete(PracticeExam).where(PracticeExam.user_id == user.id))
        await db_session.execute(delete(Document).where(Document.id == document.id))
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


async def test_generate_practice_exam_clear_error_with_no_documents_at_all(db_session):
    user = User(keycloak_sub=f"test-gen-exam-empty-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.commit()
    try:
        result = await PracticeExamGenerationTool().run(user_id=str(user.id))
        assert result.startswith("Error:")
    finally:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


# ---------------------------------------------------------------------------
# generate_study_plan
# ---------------------------------------------------------------------------


async def test_generate_study_plan_creates_real_persisted_items(free_user_with_document, db_session, monkeypatch):
    user, document = free_user_with_document
    monkeypatch.setattr(study_planner, "get_provider", lambda **kwargs: (_study_plan_script(), "fake-model"))
    monkeypatch.setattr(study_planner, "get_document_text", _fake_get_document_text)

    result = await StudyPlanGenerationTool().run(document_filename="biology", user_id=str(user.id))

    assert "1 study plan item(s)" in result
    items = (
        await db_session.execute(select(StudyPlanItem).where(StudyPlanItem.document_id == document.id))
    ).scalars().all()
    assert len(items) == 1


# ---------------------------------------------------------------------------
# Registry-level: proves user_id threading reaches these tools through the real
# run_tool() mechanism, the same path the WebSocket chat handler actually uses.
# ---------------------------------------------------------------------------


async def test_run_tool_threads_user_id_through_to_generate_flashcards(free_user_with_document, monkeypatch):
    user, _document = free_user_with_document
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (_flashcards_script(), "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

    result = await run_tool(
        "generate_flashcards", {"document_filename": "biology"}, session_id="unused", user_id=str(user.id)
    )
    assert "biology-notes.txt" in result
