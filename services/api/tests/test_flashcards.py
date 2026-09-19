import uuid
from datetime import datetime, timedelta, timezone

import fsrs
import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import Document, Flashcard, FlashcardReviewLog, User
from app.services import documents as documents_service
from app.services import flashcards as flashcards_service
from app.services.flashcards import (
    DIRECTION_PRODUCTION,
    DIRECTION_RECOGNITION,
    GRADE_CLOSE,
    GRADE_CORRECT,
    GRADE_WRONG,
    _apply_card_to_row,
    _card_from_row,
    card_direction,
    fold_diacritics,
    generate_flashcards,
    get_due_flashcards,
    grade_production_answer,
    normalize_production_answer,
    parse_flashcards,
    review_flashcard,
    review_production_flashcard,
)
from tests.fakes import ScriptedToolCallingProvider

# ---------------------------------------------------------------------------
# Pure parsing tests — no DB, no network, no provider.
# ---------------------------------------------------------------------------


def test_parse_flashcards_extracts_valid_cards():
    raw = 'Sure:\n{"cards": [{"front": "What is FSRS?", "back": "A spaced-repetition scheduler."}]}'
    cards = parse_flashcards(raw)
    assert len(cards) == 1
    assert cards[0]["front"] == "What is FSRS?"


def test_parse_flashcards_filters_cards_missing_front_or_back():
    raw = '{"cards": [{"front": "no answer"}, {"back": "no question"}, {"front": "Q", "back": "A"}]}'
    cards = parse_flashcards(raw)
    assert len(cards) == 1
    assert cards[0]["front"] == "Q"


def test_parse_flashcards_returns_empty_list_for_unparseable_text():
    assert parse_flashcards("[echo/no-provider-configured] you said: whatever") == []


def test_parse_flashcards_handles_empty_cards_list():
    assert parse_flashcards('{"cards": []}') == []


def test_parse_flashcards_handles_non_list_cards_field():
    assert parse_flashcards('{"cards": "not a list"}') == []


# ---------------------------------------------------------------------------
# Direction + typed-answer grading — pure functions, no DB, no network.
# ---------------------------------------------------------------------------


def test_card_direction_reads_null_as_recognition():
    """Every row written before migration 0021 has direction NULL. Reading that as
    "recognition" is what lets the migration skip a backfill entirely — if this ever
    stops being true, every existing card silently changes behaviour."""
    assert card_direction(Flashcard(front="Q", back="A")) == DIRECTION_RECOGNITION
    assert card_direction(Flashcard(front="Q", back="A", direction=None)) == DIRECTION_RECOGNITION
    assert (
        card_direction(Flashcard(front="Q", back="A", direction=DIRECTION_PRODUCTION))
        == DIRECTION_PRODUCTION
    )


@pytest.mark.parametrize(
    "typed,expected",
    [
        ("casa", "casa"),
        ("  casa  ", "casa"),  # trimmed
        ("CASA", "casa"),  # case-folded
        ("casa.", "casa"),  # trailing punctuation
        ("¿casa?", "casa"),  # non-ASCII punctuation, both ends
        ("the mitochondrion", "mitochondrion"),  # leading English article
        ("a priori", "priori"),
        ("photo   synthesis", "photo synthesis"),  # internal whitespace collapsed
    ],
)
def test_normalize_production_answer_is_forgiving_about_formatting(typed, expected):
    assert normalize_production_answer(typed) == expected


def test_normalize_production_answer_preserves_accents():
    """Accents survive normalization on purpose — folding them away is a separate,
    weaker comparison used only for the "close" tier, never for "correct"."""
    assert normalize_production_answer("Recuperación.") == "recuperación"


def test_normalize_production_answer_never_empties_a_bare_article():
    """"the" is a legitimate answer on a grammar card; the article rule must not delete
    the entire answer and leave an empty string that can only ever be graded wrong."""
    assert normalize_production_answer("The") == "the"
    assert normalize_production_answer("a") == "a"


def test_normalize_production_answer_unifies_composed_and_decomposed_accents():
    """The same word typed by two different IMEs: U+00E9 vs. e + U+0301. Byte-unequal,
    visually identical, and marking the second one wrong would be indefensible."""
    composed = "café"
    decomposed = "café"
    assert composed != decomposed
    assert normalize_production_answer(composed) == normalize_production_answer(decomposed)


def test_fold_diacritics_strips_marks_without_touching_base_letters():
    assert fold_diacritics("recuperación") == "recuperacion"
    assert fold_diacritics("über") == "uber"
    assert fold_diacritics("casa") == "casa"


def test_grade_production_answer_accepts_an_exact_match_as_good():
    assert grade_production_answer("la casa", "la casa") == (GRADE_CORRECT, 3)


def test_grade_production_answer_accepts_formatting_differences_as_good():
    """Capitalization, a trailing period and stray whitespace are not knowledge."""
    assert grade_production_answer("  La Casa. ", "la casa") == (GRADE_CORRECT, 3)


def test_grade_production_answer_scores_a_missing_accent_as_close_not_wrong():
    """THE documented accent decision, pinned by a test so it can't drift silently:
    "recuperacion" for "recuperación" is graded "close" and becomes FSRS rating 2
    (Hard) — credited as a successful retrieval, but asked again sooner, because the
    accent really is part of the correct Spanish spelling. It is deliberately NOT a
    full pass (3/Good) and deliberately NOT a failure (1/Again)."""
    assert grade_production_answer("recuperacion", "recuperación") == (GRADE_CLOSE, 2)
    # ...and symmetrically, an accent the student added that isn't there.
    assert grade_production_answer("recuperación", "recuperacion") == (GRADE_CLOSE, 2)


def test_grade_production_answer_rejects_a_different_word():
    assert grade_production_answer("el perro", "la casa") == (GRADE_WRONG, 1)


def test_grade_production_answer_rejects_an_empty_answer():
    """A student who submits nothing failed to produce the word — that is the single
    most important thing a production card measures, so it must never fall through to
    any partial credit."""
    assert grade_production_answer("", "la casa") == (GRADE_WRONG, 1)
    assert grade_production_answer("   ", "la casa") == (GRADE_WRONG, 1)


def test_grade_production_answer_does_not_strip_a_spanish_article():
    """Documented limitation of the forgiving rules, asserted rather than assumed: only
    the ENGLISH articles are ignored. "casa" for "la casa" is wrong here because the
    article carries grammatical gender, which is part of what the card teaches."""
    assert grade_production_answer("casa", "la casa") == (GRADE_WRONG, 1)


def test_grade_production_answer_does_not_fold_marks_on_cjk_answers():
    """The accent-folding tier is disabled for Han/kana/Hangul answers — see the module
    comment in app/services/flashcards.py. Folding combining marks off CJK text is not a
    kindness, it's a wrong answer awarded partial credit."""
    assert grade_production_answer("家", "家") == (GRADE_CORRECT, 3)
    assert grade_production_answer("字", "家") == (GRADE_WRONG, 1)


# ---------------------------------------------------------------------------
# Card <-> row round trip — no DB, no network.
# ---------------------------------------------------------------------------


def test_card_row_round_trip_preserves_a_fresh_card():
    row = Flashcard(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        front="Q",
        back="A",
        fsrs_state="learning",
        fsrs_step=0,
        fsrs_stability=None,
        fsrs_difficulty=None,
        due=datetime(2026, 1, 1, tzinfo=timezone.utc),
        last_review=None,
    )
    card = _card_from_row(row)
    assert card.state == fsrs.State.Learning
    assert card.stability is None
    assert card.due == row.due

    # round-tripping the same card back through _apply_card_to_row must be a no-op
    row2 = Flashcard(id=row.id, user_id=row.user_id, front="Q", back="A")
    _apply_card_to_row(row2, card)
    assert row2.fsrs_state == row.fsrs_state
    assert row2.fsrs_step == row.fsrs_step
    assert row2.due == row.due


def test_card_row_round_trip_preserves_a_reviewed_card():
    row = Flashcard(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        front="Q",
        back="A",
        fsrs_state="review",
        fsrs_step=None,
        fsrs_stability=5.4,
        fsrs_difficulty=3.2,
        due=datetime(2026, 3, 1, tzinfo=timezone.utc),
        last_review=datetime(2026, 2, 20, tzinfo=timezone.utc),
    )
    card = _card_from_row(row)
    assert card.state == fsrs.State.Review
    assert card.stability == 5.4
    assert card.difficulty == 3.2
    assert card.last_review == row.last_review


# ---------------------------------------------------------------------------
# review_flashcard — real FSRS scheduling math, in-memory row (no DB needed since
# review_flashcard only mutates the row object + adds a log; flushing needs a real
# session, covered by the DB-level tests below).
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_user(db_session):
    user = User(keycloak_sub=f"test-flashcards-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    yield user
    await db_session.execute(delete(FlashcardReviewLog).where(FlashcardReviewLog.user_id == user.id))
    await db_session.execute(delete(Flashcard).where(Flashcard.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_review_flashcard_pushes_due_date_forward_and_logs_it(db_session, throwaway_user):
    card = Flashcard(user_id=throwaway_user.id, front="Q", back="A")
    db_session.add(card)
    await db_session.flush()
    original_due = card.due

    updated = await review_flashcard(db_session, card, rating=3)  # Good
    await db_session.commit()

    assert updated.due > original_due
    assert updated.last_review is not None
    assert updated.fsrs_stability is not None

    logs = (
        await db_session.execute(
            select(FlashcardReviewLog).where(FlashcardReviewLog.flashcard_id == card.id)
        )
    ).scalars().all()
    assert len(logs) == 1
    assert logs[0].rating == 3
    assert logs[0].user_id == throwaway_user.id


async def test_review_flashcard_again_reschedules_sooner_than_good(db_session, throwaway_user):
    card_again = Flashcard(user_id=throwaway_user.id, front="Q1", back="A1")
    card_good = Flashcard(user_id=throwaway_user.id, front="Q2", back="A2")
    db_session.add_all([card_again, card_good])
    await db_session.flush()

    await review_flashcard(db_session, card_again, rating=1)  # Again
    await review_flashcard(db_session, card_good, rating=3)  # Good
    await db_session.commit()

    assert card_again.due <= card_good.due


async def test_review_flashcard_rejects_out_of_range_rating(db_session, throwaway_user):
    card = Flashcard(user_id=throwaway_user.id, front="Q", back="A")
    db_session.add(card)
    await db_session.flush()

    with pytest.raises(ValueError):
        await review_flashcard(db_session, card, rating=0)


async def test_review_production_flashcard_grades_and_schedules_without_self_rating(
    db_session, throwaway_user
):
    """The production path end to end: the student types an answer, the server grades it,
    and the grade becomes a real FSRS review — no self-rating anywhere."""
    card = Flashcard(
        user_id=throwaway_user.id,
        front="house",
        back="la casa",
        direction=DIRECTION_PRODUCTION,
    )
    db_session.add(card)
    await db_session.flush()
    original_due = card.due

    updated, grading = await review_production_flashcard(db_session, card, "La casa.")
    await db_session.commit()

    assert grading["result"] == GRADE_CORRECT
    assert grading["rating"] == 3
    assert grading["expected"] == "la casa"
    assert grading["answer"] == "La casa."
    assert updated.due > original_due
    assert updated.fsrs_stability is not None

    logs = (
        await db_session.execute(
            select(FlashcardReviewLog).where(FlashcardReviewLog.flashcard_id == card.id)
        )
    ).scalars().all()
    assert len(logs) == 1
    assert logs[0].rating == 3


async def test_review_production_flashcard_logs_again_for_a_wrong_answer(db_session, throwaway_user):
    card = Flashcard(
        user_id=throwaway_user.id, front="house", back="la casa", direction=DIRECTION_PRODUCTION
    )
    db_session.add(card)
    await db_session.flush()

    _, grading = await review_production_flashcard(db_session, card, "el perro")
    await db_session.commit()

    assert grading["result"] == GRADE_WRONG
    logs = (
        await db_session.execute(
            select(FlashcardReviewLog).where(FlashcardReviewLog.flashcard_id == card.id)
        )
    ).scalars().all()
    assert [log.rating for log in logs] == [1]


async def test_recognition_and_production_cards_for_one_term_schedule_independently(
    db_session, throwaway_user
):
    """The load-bearing claim of this whole feature, proved against real FSRS state
    rather than assumed: because direction is a separate ROW and fsrs.Scheduler holds no
    per-card state, reviewing one direction of a term leaves the other's schedule
    untouched — no shared "family" interval, no coupling of any kind.

    Reviewing ONLY the production card and then reading both rows back from Postgres."""
    recognition = Flashcard(
        user_id=throwaway_user.id, front="la casa", back="house", direction=DIRECTION_RECOGNITION
    )
    production = Flashcard(
        user_id=throwaway_user.id, front="house", back="la casa", direction=DIRECTION_PRODUCTION
    )
    db_session.add_all([recognition, production])
    await db_session.flush()
    recognition_due_before = recognition.due

    # Only the production direction is reviewed — and failed, the case most likely to
    # leak into a sibling if anything were shared.
    _, grading = await review_production_flashcard(db_session, production, "el perro")
    await db_session.commit()
    assert grading["result"] == GRADE_WRONG

    await db_session.refresh(recognition)
    await db_session.refresh(production)

    # The untouched direction is byte-for-byte the never-reviewed card it was.
    assert recognition.last_review is None
    assert recognition.fsrs_stability is None
    assert recognition.fsrs_difficulty is None
    assert recognition.due == recognition_due_before
    assert recognition.fsrs_state == "learning"

    # The reviewed one really did move.
    assert production.last_review is not None
    assert production.fsrs_stability is not None

    # And the review log — the audit trail — attributes it to exactly one card.
    logged_ids = (
        await db_session.execute(
            select(FlashcardReviewLog.flashcard_id).where(
                FlashcardReviewLog.flashcard_id.in_([recognition.id, production.id])
            )
        )
    ).scalars().all()
    assert logged_ids == [production.id]

    # Now review the OTHER direction, with a different rating, and confirm the two rows
    # end up with genuinely different FSRS state rather than converging on a shared one.
    await review_flashcard(db_session, recognition, rating=4)  # Easy
    await db_session.commit()
    await db_session.refresh(recognition)
    await db_session.refresh(production)

    assert recognition.fsrs_stability != production.fsrs_stability
    assert recognition.fsrs_difficulty != production.fsrs_difficulty
    # Easy on the recognition card vs. Again on the production one: the easy direction
    # is scheduled strictly further out, which is the pedagogical point.
    assert recognition.due > production.due


async def test_get_due_flashcards_only_returns_cards_due_now_or_earlier(db_session, throwaway_user):
    now = datetime.now(timezone.utc)
    due_card = Flashcard(user_id=throwaway_user.id, front="due", back="A", due=now - timedelta(minutes=1))
    future_card = Flashcard(
        user_id=throwaway_user.id, front="future", back="A", due=now + timedelta(days=30)
    )
    db_session.add_all([due_card, future_card])
    await db_session.commit()

    due = await get_due_flashcards(db_session, throwaway_user.id)
    fronts = {c.front for c in due}
    assert "due" in fronts
    assert "future" not in fronts


# ---------------------------------------------------------------------------
# generate_flashcards orchestration — real DB rows, scripted provider.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_document(db_session):
    user = User(keycloak_sub=f"test-flashcards-doc-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    document = Document(user_id=user.id, filename="notes.txt", mime_type="text/plain", minio_key="unused")
    db_session.add(document)
    await db_session.flush()
    await db_session.commit()

    yield user, document

    await db_session.execute(delete(FlashcardReviewLog).where(FlashcardReviewLog.user_id == user.id))
    await db_session.execute(delete(Flashcard).where(Flashcard.user_id == user.id))
    await db_session.execute(delete(Document).where(Document.id == document.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def _fake_get_document_text(_document) -> str:
    return "FSRS is a spaced repetition algorithm. It schedules reviews based on memory stability."


async def test_generate_flashcards_creates_rows_from_a_well_formed_response(
    throwaway_document, db_session, monkeypatch
):
    user, document = throwaway_document
    fake = ScriptedToolCallingProvider(
        [
            [
                '{"cards": [',
                '{"front": "What does FSRS stand for?", "back": "Free Spaced Repetition Scheduler"},',
                '{"front": "What does FSRS schedule reviews based on?", "back": "Memory stability"}',
                "]}",
            ]
        ]
    )
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

    cards = await generate_flashcards(db_session, user.id, document)
    await db_session.commit()

    assert len(cards) == 2
    fsrs_card = next(c for c in cards if "stand for" in c.front)
    assert fsrs_card.back == "Free Spaced Repetition Scheduler"
    assert fsrs_card.document_id == document.id
    assert fsrs_card.user_id == user.id
    # fresh cards start immediately due, in FSRS's own "never reviewed" state
    assert fsrs_card.fsrs_stability is None

    rows = (
        (await db_session.execute(select(Flashcard).where(Flashcard.user_id == user.id)))
        .scalars()
        .all()
    )
    assert len(rows) == 2


async def test_generate_flashcards_defaults_to_recognition_only(
    throwaway_document, db_session, monkeypatch
):
    """Regression guard on the existing behaviour: without the explicit opt-in, nothing
    about generation changes — one card per fact, recognition direction, no doubling of
    anyone's daily review load."""
    user, document = throwaway_document
    fake = ScriptedToolCallingProvider(
        [['{"cards": [{"front": "la casa", "back": "house"}]}']]
    )
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

    cards = await generate_flashcards(db_session, user.id, document)
    await db_session.commit()

    assert len(cards) == 1
    assert cards[0].direction == DIRECTION_RECOGNITION
    assert (cards[0].front, cards[0].back) == ("la casa", "house")


async def test_generate_flashcards_adds_a_production_sibling_when_asked(
    throwaway_document, db_session, monkeypatch
):
    """Opt-in production cards: each generated card gets a reversed sibling whose front
    is the prompt shown and whose back is the term to be typed — so `back` is always
    "the expected answer" no matter which direction a card drills, and no caller that
    merely displays a card has to know direction exists."""
    user, document = throwaway_document
    fake = ScriptedToolCallingProvider(
        [
            [
                '{"cards": [',
                '{"front": "la casa", "back": "house"},',
                '{"front": "el perro", "back": "dog"}',
                "]}",
            ]
        ]
    )
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

    cards = await generate_flashcards(
        db_session, user.id, document, include_production_cards=True
    )
    await db_session.commit()

    assert len(cards) == 4
    recognition = [c for c in cards if c.direction == DIRECTION_RECOGNITION]
    production = [c for c in cards if c.direction == DIRECTION_PRODUCTION]
    assert len(recognition) == 2
    assert len(production) == 2

    casa_recognition = next(c for c in recognition if c.front == "la casa")
    casa_production = next(c for c in production if c.back == "la casa")
    assert casa_recognition.back == "house"
    assert casa_production.front == "house"  # shown the meaning...
    assert casa_production.back == "la casa"  # ...must produce the term
    assert casa_production.document_id == document.id
    assert casa_production.user_id == user.id
    # Two genuinely separate rows, each with its own fresh FSRS state.
    assert casa_production.id != casa_recognition.id
    assert casa_production.fsrs_stability is None

    rows = (
        (await db_session.execute(select(Flashcard).where(Flashcard.user_id == user.id)))
        .scalars()
        .all()
    )
    assert len(rows) == 4


async def test_generate_flashcards_creates_no_rows_for_an_unparseable_response(
    throwaway_document, db_session, monkeypatch
):
    user, document = throwaway_document
    fake = ScriptedToolCallingProvider([["Sorry, I won't give you JSON."]])
    monkeypatch.setattr(flashcards_service, "get_provider", lambda **kwargs: (fake, "fake-model"))
    monkeypatch.setattr(flashcards_service, "get_document_text", _fake_get_document_text)

    cards = await generate_flashcards(db_session, user.id, document)
    assert cards == []


async def test_deleting_a_document_does_not_destroy_its_flashcards(throwaway_document, db_session):
    """Same FK-survival intent as study_plan_items — a flashcard shouldn't disappear (or
    block deletion) just because its source document was removed."""
    user, document = throwaway_document
    card = Flashcard(user_id=user.id, document_id=document.id, front="Q", back="A")
    db_session.add(card)
    await db_session.commit()

    await documents_service.delete_document(db_session, document)

    await db_session.refresh(card)
    assert card.document_id is None
    assert card.front == "Q"


# ---------------------------------------------------------------------------
# Router-level tests — real HTTP against the live server.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def uploaded_document(http_client, auth_headers, db_session):
    content = b"Newton's first law: an object in motion stays in motion unless acted on by a force."
    resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("physics-notes.txt", content, "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    document_id = uuid.UUID(resp.json()["id"])

    yield document_id

    await db_session.execute(
        delete(FlashcardReviewLog).where(
            FlashcardReviewLog.flashcard_id.in_(
                select(Flashcard.id).where(Flashcard.document_id == document_id)
            )
        )
    )
    await db_session.execute(delete(Flashcard).where(Flashcard.document_id == document_id))
    document = await db_session.get(Document, document_id)
    if document is not None:
        await documents_service.delete_document(db_session, document)


async def test_generate_requires_auth(http_client):
    resp = await http_client.post(f"/flashcards/generate/{uuid.uuid4()}")
    assert resp.status_code == 401


async def test_generate_404s_for_a_nonexistent_document(http_client, auth_headers):
    resp = await http_client.post(f"/flashcards/generate/{uuid.uuid4()}", headers=auth_headers)
    assert resp.status_code == 404


async def test_generate_returns_a_list_and_cards_show_up_in_list_endpoint(
    uploaded_document, http_client, auth_headers
):
    resp = await http_client.post(f"/flashcards/generate/{uploaded_document}", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

    list_resp = await http_client.get("/flashcards", headers=auth_headers)
    assert list_resp.status_code == 200
    returned_ids = {c["id"] for c in resp.json()}
    listed_ids = {c["id"] for c in list_resp.json()}
    assert returned_ids <= listed_ids


async def test_review_endpoint_updates_and_returns_the_card(uploaded_document, http_client, auth_headers, db_session):
    document = await db_session.get(Document, uploaded_document)
    card = Flashcard(user_id=document.user_id, document_id=document.id, front="Q", back="A")
    db_session.add(card)
    await db_session.commit()
    original_due = card.due

    resp = await http_client.post(
        f"/flashcards/{card.id}/review", headers=auth_headers, json={"rating": 3}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(card.id)

    await db_session.refresh(card)
    assert card.due > original_due
    assert card.last_review is not None


async def test_review_endpoint_reports_the_direction_of_a_legacy_card(
    uploaded_document, http_client, auth_headers, db_session
):
    """A row whose `direction` column is NULL (i.e. every card that existed before
    migration 0021) must come back over the API as an ordinary recognition card, and
    must still be reviewable exactly the way it always was."""
    document = await db_session.get(Document, uploaded_document)
    card = Flashcard(user_id=document.user_id, document_id=document.id, front="Q", back="A")
    db_session.add(card)
    await db_session.commit()
    await db_session.refresh(card)
    assert card.direction is None  # no column default anywhere — NULL is the legacy shape

    resp = await http_client.post(
        f"/flashcards/{card.id}/review", headers=auth_headers, json={"rating": 3}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["direction"] == "recognition"
    assert "grading" not in body


async def test_review_endpoint_grades_a_typed_production_answer(
    uploaded_document, http_client, auth_headers, db_session
):
    document = await db_session.get(Document, uploaded_document)
    card = Flashcard(
        user_id=document.user_id,
        document_id=document.id,
        front="recovery",
        back="recuperación",
        direction=DIRECTION_PRODUCTION,
    )
    db_session.add(card)
    await db_session.commit()
    original_due = card.due

    resp = await http_client.post(
        f"/flashcards/{card.id}/review",
        headers=auth_headers,
        json={"typed_answer": "recuperacion"},  # the accent case, over real HTTP
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["direction"] == "production"
    assert body["grading"]["result"] == GRADE_CLOSE
    assert body["grading"]["rating"] == 2
    assert body["grading"]["expected"] == "recuperación"

    await db_session.refresh(card)
    assert card.due > original_due
    assert card.last_review is not None


async def test_review_endpoint_rejects_a_typed_answer_on_a_recognition_card(
    uploaded_document, http_client, auth_headers, db_session
):
    """A recognition card's back is a full answer, not a term — grading a typed attempt
    against it would fail nearly everyone, so say what's wrong instead."""
    document = await db_session.get(Document, uploaded_document)
    card = Flashcard(
        user_id=document.user_id,
        document_id=document.id,
        front="What is FSRS?",
        back="A spaced-repetition scheduler",
        direction=DIRECTION_RECOGNITION,
    )
    db_session.add(card)
    await db_session.commit()

    resp = await http_client.post(
        f"/flashcards/{card.id}/review",
        headers=auth_headers,
        json={"typed_answer": "a spaced-repetition scheduler"},
    )
    assert resp.status_code == 400
    await db_session.refresh(card)
    assert card.last_review is None


async def test_review_endpoint_rejects_a_body_with_neither_rating_nor_answer(
    uploaded_document, http_client, auth_headers, db_session
):
    document = await db_session.get(Document, uploaded_document)
    card = Flashcard(user_id=document.user_id, document_id=document.id, front="Q", back="A")
    db_session.add(card)
    await db_session.commit()

    resp = await http_client.post(f"/flashcards/{card.id}/review", headers=auth_headers, json={})
    assert resp.status_code == 400


async def test_review_endpoint_lets_an_explicit_rating_override_grading(
    uploaded_document, http_client, auth_headers, db_session
):
    """Both fields sent: the student's own rating wins. Someone who disagrees with a
    grade shouldn't have to fight the API about it."""
    document = await db_session.get(Document, uploaded_document)
    card = Flashcard(
        user_id=document.user_id,
        document_id=document.id,
        front="house",
        back="la casa",
        direction=DIRECTION_PRODUCTION,
    )
    db_session.add(card)
    await db_session.commit()

    resp = await http_client.post(
        f"/flashcards/{card.id}/review",
        headers=auth_headers,
        json={"rating": 4, "typed_answer": "totally wrong"},
    )
    assert resp.status_code == 200, resp.text
    assert "grading" not in resp.json()

    logs = (
        await db_session.execute(
            select(FlashcardReviewLog).where(FlashcardReviewLog.flashcard_id == card.id)
        )
    ).scalars().all()
    assert [log.rating for log in logs] == [4]


async def test_generate_endpoint_can_create_production_siblings(
    uploaded_document, http_client, auth_headers
):
    resp = await http_client.post(
        f"/flashcards/generate/{uploaded_document}",
        headers=auth_headers,
        params={"include_production": "true"},
    )
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    directions = {c["direction"] for c in cards}
    # The document is real prose run through a real provider, so the card COUNT isn't
    # assertable — but every card must carry a direction, and if anything was generated
    # at all it must have come in matched pairs.
    assert directions <= {"recognition", "production"}
    if cards:
        assert directions == {"recognition", "production"}
        assert len([c for c in cards if c["direction"] == "recognition"]) == len(
            [c for c in cards if c["direction"] == "production"]
        )


async def test_review_endpoint_rejects_invalid_rating(uploaded_document, http_client, auth_headers, db_session):
    document = await db_session.get(Document, uploaded_document)
    card = Flashcard(user_id=document.user_id, document_id=document.id, front="Q", back="A")
    db_session.add(card)
    await db_session.commit()

    resp = await http_client.post(
        f"/flashcards/{card.id}/review", headers=auth_headers, json={"rating": 7}
    )
    assert resp.status_code == 422


async def test_review_endpoint_404s_for_another_users_card(throwaway_document, http_client, auth_headers, db_session):
    _, document = throwaway_document
    card = Flashcard(user_id=document.user_id, document_id=document.id, front="Q", back="A")
    db_session.add(card)
    await db_session.commit()

    resp = await http_client.post(
        f"/flashcards/{card.id}/review", headers=auth_headers, json={"rating": 3}
    )
    assert resp.status_code == 404


async def test_delete_flashcard_removes_it(uploaded_document, http_client, auth_headers, db_session):
    document = await db_session.get(Document, uploaded_document)
    card = Flashcard(user_id=document.user_id, document_id=document.id, front="Q", back="A")
    db_session.add(card)
    await db_session.commit()

    resp = await http_client.delete(f"/flashcards/{card.id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"status": "deleted"}

    remaining = (
        await db_session.execute(select(Flashcard).where(Flashcard.id == card.id))
    ).scalar_one_or_none()
    assert remaining is None


async def test_delete_flashcard_404s_for_another_users_card(throwaway_document, http_client, auth_headers, db_session):
    _, document = throwaway_document
    card = Flashcard(user_id=document.user_id, document_id=document.id, front="Q", back="A")
    db_session.add(card)
    await db_session.commit()

    resp = await http_client.delete(f"/flashcards/{card.id}", headers=auth_headers)
    assert resp.status_code == 404
    assert await db_session.get(Flashcard, card.id) is not None


async def test_due_only_filter_excludes_future_cards(uploaded_document, http_client, auth_headers, db_session):
    document = await db_session.get(Document, uploaded_document)
    future_card = Flashcard(
        user_id=document.user_id,
        document_id=document.id,
        front="future card unique marker",
        back="A",
        due=datetime.now(timezone.utc) + timedelta(days=365),
    )
    db_session.add(future_card)
    await db_session.commit()

    resp = await http_client.get("/flashcards", headers=auth_headers, params={"due_only": "true"})
    assert resp.status_code == 200
    fronts = {c["front"] for c in resp.json()}
    assert "future card unique marker" not in fronts
