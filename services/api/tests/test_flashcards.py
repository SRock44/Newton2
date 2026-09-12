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
    _apply_card_to_row,
    _card_from_row,
    generate_flashcards,
    get_due_flashcards,
    parse_flashcards,
    review_flashcard,
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
