import uuid
from datetime import date, datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import delete

from app.db.models import ChatMessage, ChatSession, Flashcard, FlashcardReviewLog, StudyPlanItem, User
from app.services.gamification import (
    XP_PER_FLASHCARD_GENERATED,
    XP_PER_FLASHCARD_REVIEW,
    XP_PER_STUDY_PLAN_ITEM,
    XP_PER_USER_MESSAGE,
    _streak_from_dates,
    get_stats,
    get_streak_days,
    get_xp,
    level_for_xp,
)

TODAY = date(2026, 9, 15)

# ---------------------------------------------------------------------------
# _streak_from_dates / level_for_xp — pure functions, no DB.
# ---------------------------------------------------------------------------


def test_streak_is_zero_with_no_activity():
    assert _streak_from_dates(set(), TODAY) == 0


def test_streak_counts_consecutive_days_including_today():
    dates = {TODAY, TODAY - timedelta(days=1), TODAY - timedelta(days=2)}
    assert _streak_from_dates(dates, TODAY) == 3


def test_streak_still_counts_if_nothing_happened_yet_today():
    # active yesterday and the day before, nothing logged today yet — still a live streak
    dates = {TODAY - timedelta(days=1), TODAY - timedelta(days=2)}
    assert _streak_from_dates(dates, TODAY) == 2


def test_streak_breaks_after_a_full_day_with_no_activity():
    # active two days ago, but NOT yesterday and NOT today — streak is broken
    dates = {TODAY - timedelta(days=2)}
    assert _streak_from_dates(dates, TODAY) == 0


def test_streak_stops_at_the_first_gap():
    dates = {TODAY, TODAY - timedelta(days=1), TODAY - timedelta(days=3)}  # gap at day 2
    assert _streak_from_dates(dates, TODAY) == 2


def test_level_for_xp_thresholds():
    assert level_for_xp(0) == 1
    assert level_for_xp(99) == 1
    assert level_for_xp(100) == 2
    assert level_for_xp(250) == 3


# ---------------------------------------------------------------------------
# DB-level: get_streak_days / get_xp / get_stats against real rows.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_user_with_session(db_session):
    user = User(keycloak_sub=f"test-gamification-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    session = ChatSession(user_id=user.id)
    db_session.add(session)
    await db_session.flush()
    await db_session.commit()

    yield user, session

    await db_session.execute(delete(FlashcardReviewLog).where(FlashcardReviewLog.user_id == user.id))
    await db_session.execute(delete(Flashcard).where(Flashcard.user_id == user.id))
    await db_session.execute(delete(StudyPlanItem).where(StudyPlanItem.user_id == user.id))
    await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
    await db_session.execute(delete(ChatSession).where(ChatSession.id == session.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


def _at(days_ago: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days_ago)


async def test_get_streak_days_counts_real_chat_messages_and_reviews(
    db_session, throwaway_user_with_session
):
    user, session = throwaway_user_with_session
    db_session.add_all(
        [
            ChatMessage(session_id=session.id, role="user", content="hi", created_at=_at(0)),
            ChatMessage(session_id=session.id, role="assistant", content="hello", created_at=_at(0)),
        ]
    )
    card = Flashcard(user_id=user.id, front="Q", back="A")
    db_session.add(card)
    await db_session.flush()
    db_session.add(FlashcardReviewLog(flashcard_id=card.id, user_id=user.id, rating=3, reviewed_at=_at(1)))
    await db_session.commit()

    streak = await get_streak_days(db_session, user.id)
    assert streak == 2  # today (chat) + yesterday (review)


async def test_get_streak_days_ignores_assistant_messages(db_session, throwaway_user_with_session):
    user, session = throwaway_user_with_session
    db_session.add(ChatMessage(session_id=session.id, role="assistant", content="hello", created_at=_at(0)))
    await db_session.commit()

    assert await get_streak_days(db_session, user.id) == 0


async def test_get_xp_sums_weighted_activity_counts(db_session, throwaway_user_with_session):
    user, session = throwaway_user_with_session
    db_session.add(ChatMessage(session_id=session.id, role="user", content="hi", created_at=_at(0)))
    db_session.add(ChatMessage(session_id=session.id, role="user", content="hi again", created_at=_at(1)))
    db_session.add(StudyPlanItem(user_id=user.id, title="Item"))
    card = Flashcard(user_id=user.id, front="Q", back="A")
    db_session.add(card)
    await db_session.flush()
    db_session.add(FlashcardReviewLog(flashcard_id=card.id, user_id=user.id, rating=3))
    await db_session.commit()

    xp = await get_xp(db_session, user.id)
    expected = (
        2 * XP_PER_USER_MESSAGE
        + 1 * XP_PER_FLASHCARD_REVIEW
        + 1 * XP_PER_STUDY_PLAN_ITEM
        + 1 * XP_PER_FLASHCARD_GENERATED
    )
    assert xp == expected


async def test_get_stats_shape(db_session, throwaway_user_with_session):
    user, _session = throwaway_user_with_session
    stats = await get_stats(db_session, user.id)
    assert stats == {"streak_days": 0, "xp": 0, "level": 1, "xp_to_next_level": 100}


# ---------------------------------------------------------------------------
# Router-level — real HTTP against the live server.
# ---------------------------------------------------------------------------


async def test_stats_endpoint_requires_auth(http_client):
    resp = await http_client.get("/gamification/stats")
    assert resp.status_code == 401


async def test_stats_endpoint_returns_the_expected_shape(http_client, auth_headers):
    resp = await http_client.get("/gamification/stats", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"streak_days", "xp", "level", "xp_to_next_level"}
    assert isinstance(body["streak_days"], int)
    assert isinstance(body["xp"], int)
    assert body["level"] >= 1
