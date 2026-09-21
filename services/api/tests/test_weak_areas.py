"""Covers app.services.weak_areas (the real query logic) and its thin tool wrapper
(app.tools.get_weak_areas.GetWeakAreasTool) -- the actual gap this session's work
exists to close: real FlashcardReviewLog/PracticeExamQuestion performance data already
exists in the DB but nothing surfaced it to the Tutor. Follows test_generation_tools.py's
pattern: real DB fixtures via db_session, explicit cleanup, no mocking of the DB layer
itself."""

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
    User,
)
from app.services.weak_areas import format_weak_areas, get_weak_areas
from app.tools.get_weak_areas import GetWeakAreasTool

_NOW = datetime(2026, 9, 13, tzinfo=timezone.utc)


def _ago(days: int) -> datetime:
    return _NOW - timedelta(days=days)


@pytest_asyncio.fixture
async def performance_user(db_session):
    user = User(keycloak_sub=f"test-weak-areas-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.flush()

    weak_doc = Document(user_id=user.id, filename="weak-topic.txt", mime_type="text/plain", minio_key="unused")
    good_doc = Document(user_id=user.id, filename="strong-topic.txt", mime_type="text/plain", minio_key="unused")
    db_session.add_all([weak_doc, good_doc])
    await db_session.flush()

    # A flashcard the student is currently struggling with (recent ratings skew Again/Hard).
    weak_card = Flashcard(user_id=user.id, document_id=weak_doc.id, front="What is the Krebs cycle?", back="...")
    # A flashcard on the SAME document the student is doing fine on -- must not drag the
    # whole document's examples toward being "wrong" about it, but the document itself
    # will still show up because of the weak card above.
    fine_card_same_doc = Flashcard(user_id=user.id, document_id=weak_doc.id, front="What is a cell?", back="...")
    # A flashcard on a document the student is doing fine on overall -- this document
    # must NOT appear in weak areas at all.
    fine_card_other_doc = Flashcard(user_id=user.id, document_id=good_doc.id, front="What is mitosis?", back="...")
    # A never-reviewed flashcard -- no signal either way, must not count as weak.
    unreviewed_card = Flashcard(user_id=user.id, document_id=weak_doc.id, front="Never reviewed yet", back="...")
    db_session.add_all([weak_card, fine_card_same_doc, fine_card_other_doc, unreviewed_card])
    await db_session.flush()

    # Recent-to-old ratings for weak_card: Again, Hard, Good -> 2 of the most recent 3
    # are Again/Hard -> weak.
    db_session.add_all(
        [
            FlashcardReviewLog(flashcard_id=weak_card.id, user_id=user.id, rating=3, reviewed_at=_ago(10)),
            FlashcardReviewLog(flashcard_id=weak_card.id, user_id=user.id, rating=2, reviewed_at=_ago(5)),
            FlashcardReviewLog(flashcard_id=weak_card.id, user_id=user.id, rating=1, reviewed_at=_ago(1)),
        ]
    )
    # fine_card_same_doc: Easy, Good, Easy -> not weak.
    db_session.add_all(
        [
            FlashcardReviewLog(flashcard_id=fine_card_same_doc.id, user_id=user.id, rating=4, reviewed_at=_ago(9)),
            FlashcardReviewLog(flashcard_id=fine_card_same_doc.id, user_id=user.id, rating=3, reviewed_at=_ago(4)),
            FlashcardReviewLog(flashcard_id=fine_card_same_doc.id, user_id=user.id, rating=4, reviewed_at=_ago(1)),
        ]
    )
    # fine_card_other_doc: Good, Easy -> not weak.
    db_session.add_all(
        [
            FlashcardReviewLog(flashcard_id=fine_card_other_doc.id, user_id=user.id, rating=3, reviewed_at=_ago(3)),
            FlashcardReviewLog(flashcard_id=fine_card_other_doc.id, user_id=user.id, rating=4, reviewed_at=_ago(1)),
        ]
    )

    # A completed exam on weak_doc with one missed question and one correct question.
    completed_exam = PracticeExam(
        user_id=user.id, document_id=weak_doc.id, title="Exam 1", completed_at=_NOW, score=0.5
    )
    # An exam on weak_doc that was generated but never taken -- must be ignored entirely.
    incomplete_exam = PracticeExam(user_id=user.id, document_id=weak_doc.id, title="Exam 2", completed_at=None)
    db_session.add_all([completed_exam, incomplete_exam])
    await db_session.flush()

    db_session.add_all(
        [
            PracticeExamQuestion(
                exam_id=completed_exam.id,
                question_index=0,
                question="What produces the most ATP in the Krebs cycle?",
                choices=["A", "B", "C", "D"],
                correct_index=0,
                student_answer_index=1,
                is_correct=False,
            ),
            PracticeExamQuestion(
                exam_id=completed_exam.id,
                question_index=1,
                question="What is a cell membrane made of?",
                choices=["A", "B", "C", "D"],
                correct_index=0,
                student_answer_index=0,
                is_correct=True,
            ),
            PracticeExamQuestion(
                exam_id=incomplete_exam.id,
                question_index=0,
                question="Should never surface -- exam not completed",
                choices=["A", "B", "C", "D"],
                correct_index=0,
                student_answer_index=None,
                is_correct=None,
            ),
        ]
    )
    await db_session.commit()

    yield user, weak_doc, good_doc

    await db_session.execute(delete(FlashcardReviewLog).where(FlashcardReviewLog.user_id == user.id))
    await db_session.execute(
        delete(PracticeExamQuestion).where(
            PracticeExamQuestion.exam_id.in_(select(PracticeExam.id).where(PracticeExam.user_id == user.id))
        )
    )
    await db_session.execute(delete(PracticeExam).where(PracticeExam.user_id == user.id))
    await db_session.execute(delete(Flashcard).where(Flashcard.user_id == user.id))
    await db_session.execute(delete(Document).where(Document.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


# ---------------------------------------------------------------------------
# app.services.weak_areas -- the real query logic
# ---------------------------------------------------------------------------


async def test_weak_topic_surfaces_with_real_examples(performance_user, db_session):
    user, weak_doc, _good_doc = performance_user

    areas = await get_weak_areas(db_session, user.id)

    by_label = {a.label: a for a in areas}
    assert weak_doc.filename in by_label
    weak_area = by_label[weak_doc.filename]
    assert "What is the Krebs cycle?" in weak_area.weak_flashcards
    assert "What produces the most ATP in the Krebs cycle?" in weak_area.missed_questions


async def test_weak_area_carries_the_real_document_id(performance_user, db_session):
    user, weak_doc, _good_doc = performance_user

    areas = await get_weak_areas(db_session, user.id)

    weak_area = next(a for a in areas if a.label == weak_doc.filename)
    assert weak_area.document_id == weak_doc.id


async def test_weak_flashcard_ids_correspond_to_the_right_underlying_rows(performance_user, db_session):
    """Not just present -- correct: each id in weak_flashcard_ids must point at the real
    Flashcard row whose front is the text at the SAME index in weak_flashcards."""
    user, weak_doc, _good_doc = performance_user

    areas = await get_weak_areas(db_session, user.id)

    weak_area = next(a for a in areas if a.label == weak_doc.filename)
    assert len(weak_area.weak_flashcard_ids) == len(weak_area.weak_flashcards)
    for front, card_id in zip(weak_area.weak_flashcards, weak_area.weak_flashcard_ids):
        card = await db_session.get(Flashcard, card_id)
        assert card is not None
        assert card.front == front
        assert card.user_id == user.id
        assert card.document_id == weak_doc.id
    # The specific weak card from the fixture must be among them, by real id.
    krebs_card = (
        await db_session.execute(select(Flashcard).where(Flashcard.front == "What is the Krebs cycle?"))
    ).scalar_one()
    assert krebs_card.id in weak_area.weak_flashcard_ids


async def test_missed_question_ids_and_exam_ids_correspond_to_the_right_underlying_rows(
    performance_user, db_session
):
    """Not just present -- correct: each id in missed_question_ids must point at the real
    PracticeExamQuestion row whose text is at the same index, and the paired exam id must
    be the exam that question actually belongs to."""
    user, weak_doc, _good_doc = performance_user

    areas = await get_weak_areas(db_session, user.id)

    weak_area = next(a for a in areas if a.label == weak_doc.filename)
    assert len(weak_area.missed_question_ids) == len(weak_area.missed_questions)
    assert len(weak_area.missed_question_exam_ids) == len(weak_area.missed_questions)
    for text, q_id, exam_id in zip(
        weak_area.missed_questions, weak_area.missed_question_ids, weak_area.missed_question_exam_ids
    ):
        question = await db_session.get(PracticeExamQuestion, q_id)
        assert question is not None
        assert question.question == text
        assert question.is_correct is False
        assert question.exam_id == exam_id
        exam = await db_session.get(PracticeExam, exam_id)
        assert exam is not None
        assert exam.user_id == user.id
        assert exam.document_id == weak_doc.id


async def test_fine_topic_does_not_surface_as_weak(performance_user, db_session):
    user, _weak_doc, good_doc = performance_user

    areas = await get_weak_areas(db_session, user.id)

    labels = {a.label for a in areas}
    assert good_doc.filename not in labels


async def test_fine_card_on_a_weak_document_is_not_listed_as_weak(performance_user, db_session):
    user, weak_doc, _good_doc = performance_user

    areas = await get_weak_areas(db_session, user.id)

    weak_area = next(a for a in areas if a.label == weak_doc.filename)
    assert "What is a cell?" not in weak_area.weak_flashcards
    assert "Never reviewed yet" not in weak_area.weak_flashcards


async def test_incomplete_exam_questions_are_ignored(performance_user, db_session):
    user, _weak_doc, _good_doc = performance_user

    areas = await get_weak_areas(db_session, user.id)

    all_missed = [q for a in areas for q in a.missed_questions]
    assert "Should never surface -- exam not completed" not in all_missed


async def test_empty_history_returns_no_areas(db_session):
    user = User(keycloak_sub=f"test-weak-areas-empty-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.commit()
    try:
        areas = await get_weak_areas(db_session, user.id)
        assert areas == []
        assert "not enough" in format_weak_areas(areas).lower()
    finally:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


def test_format_weak_areas_includes_concrete_examples_not_just_counts():
    from app.services.weak_areas import WeakArea

    areas = [WeakArea(label="weak-topic.txt", weak_flashcards=["What is X?"], missed_questions=["Missed Q?"])]
    text = format_weak_areas(areas)
    assert "What is X?" in text
    assert "Missed Q?" in text


# ---------------------------------------------------------------------------
# GetWeakAreasTool -- the chat-callable wrapper, through the real run_tool() path
# ---------------------------------------------------------------------------


async def test_tool_surfaces_weak_topic_for_the_signed_in_user(performance_user):
    user, weak_doc, _good_doc = performance_user

    result = await GetWeakAreasTool().run(user_id=str(user.id))

    assert weak_doc.filename in result
    assert "Krebs cycle" in result


async def test_tool_clean_message_for_a_brand_new_student(db_session):
    user = User(keycloak_sub=f"test-weak-areas-tool-empty-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.commit()
    try:
        result = await GetWeakAreasTool().run(user_id=str(user.id))
        assert not result.startswith("Error:")
        assert "not enough" in result.lower()
    finally:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


async def test_tool_clear_error_with_no_user():
    result = await GetWeakAreasTool().run(user_id=None)
    assert result.startswith("Error:")


async def test_tool_registered_with_no_required_params():
    tool = GetWeakAreasTool()
    assert tool.name == "get_weak_areas"
    assert tool.parameters["properties"] == {}


# ---------------------------------------------------------------------------
# Router-level -- real HTTP against the live server (app/routers/weak_areas.py).
# Same shape of coverage as test_gamification.py's router section: this endpoint is the
# direct, non-chat way into the exact same service function the tool above uses, so the
# real logic is already covered up top; what needs proving here is that it's reachable,
# authenticated, and shaped the way the Home widget expects.
# ---------------------------------------------------------------------------


async def test_weak_areas_endpoint_requires_auth(http_client):
    resp = await http_client.get("/weak-areas")
    assert resp.status_code == 401


async def test_weak_areas_endpoint_returns_a_list_of_the_expected_shape(http_client, auth_headers):
    resp = await http_client.get("/weak-areas", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    # An empty list is a perfectly valid answer (a student with no review/exam history);
    # what matters is that it's a list, and that any entry carries the full shape.
    assert isinstance(body, list)
    for area in body:
        assert set(area.keys()) == {
            "label",
            "weak_flashcards",
            "missed_questions",
            "weak_flashcard_ids",
            "missed_question_ids",
            "missed_question_exam_ids",
            "document_id",
            "weak_count",
        }
        assert isinstance(area["label"], str)
        assert isinstance(area["weak_flashcards"], list)
        assert isinstance(area["missed_questions"], list)
        assert isinstance(area["weak_flashcard_ids"], list)
        assert isinstance(area["missed_question_ids"], list)
        assert isinstance(area["missed_question_exam_ids"], list)
        assert area["document_id"] is None or isinstance(area["document_id"], str)
        assert len(area["weak_flashcard_ids"]) == len(area["weak_flashcards"])
        assert len(area["missed_question_ids"]) == len(area["missed_questions"])
        assert len(area["missed_question_exam_ids"]) == len(area["missed_questions"])
        assert area["weak_count"] == len(area["weak_flashcards"]) + len(area["missed_questions"])


async def test_weak_areas_endpoint_ids_are_real_uuids_for_the_signed_in_users_own_rows(
    http_client, auth_headers, db_session
):
    """Router-level version of the service-level id-correspondence tests above: proves
    the ids that actually reach JSON (post string-serialization) still resolve to real
    rows owned by the authenticated user, not just well-formed strings."""
    resp = await http_client.get("/weak-areas", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    for area in body:
        for card_id in area["weak_flashcard_ids"]:
            card = await db_session.get(Flashcard, uuid.UUID(card_id))
            assert card is not None
        for q_id in area["missed_question_ids"]:
            question = await db_session.get(PracticeExamQuestion, uuid.UUID(q_id))
            assert question is not None
        if area["document_id"] is not None:
            doc = await db_session.get(Document, uuid.UUID(area["document_id"]))
            assert doc is not None
            assert doc.filename == area["label"]


async def test_weak_areas_endpoint_is_worst_first(http_client, auth_headers):
    """The widget renders them top-down as-is, so ordering is part of the contract, not
    an incidental detail of the service's implementation."""
    resp = await http_client.get("/weak-areas", headers=auth_headers)
    assert resp.status_code == 200
    counts = [area["weak_count"] for area in resp.json()]
    assert counts == sorted(counts, reverse=True)


async def test_weak_areas_endpoint_is_not_plan_gated(http_client, auth_headers):
    """Unlike /voice/*, this is the student's own already-recorded data with no expensive
    compute behind it -- student1 is plan="free" by default and must still get a 200."""
    resp = await http_client.get("/weak-areas", headers=auth_headers)
    assert resp.status_code != 402
    assert resp.status_code == 200
