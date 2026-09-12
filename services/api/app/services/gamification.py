import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ChatMessage, ChatSession, Flashcard, FlashcardReviewLog, StudyPlanItem

# Simple, transparent weights rather than a "gamey" curve -- easy to reason about and
# test, and easy to retune later without touching the shape of the calculation. Reviewing
# a flashcard counts for the most since it's the most deliberate, effortful action;
# sending a chat message counts for the least since it's the lowest-effort one.
XP_PER_USER_MESSAGE = 2
XP_PER_FLASHCARD_REVIEW = 10
XP_PER_STUDY_PLAN_ITEM = 5
XP_PER_FLASHCARD_GENERATED = 3

XP_PER_LEVEL = 100


async def _activity_dates(db: AsyncSession, user_id: uuid.UUID) -> set[date]:
    """Every distinct (UTC) calendar date the user did something that should count
    toward a streak: sent a chat message, or reviewed a flashcard. Deliberately not
    "generated a study plan/flashcards" — those are one-off setup actions, not the
    daily-habit kind of activity a streak is meant to reward."""
    message_times = (
        await db.execute(
            select(ChatMessage.created_at)
            .join(ChatSession, ChatMessage.session_id == ChatSession.id)
            .where(ChatSession.user_id == user_id, ChatMessage.role == "user")
        )
    ).scalars().all()
    review_times = (
        await db.execute(
            select(FlashcardReviewLog.reviewed_at).where(FlashcardReviewLog.user_id == user_id)
        )
    ).scalars().all()
    return {t.date() for t in message_times} | {t.date() for t in review_times}


def _streak_from_dates(dates: set[date], today: date) -> int:
    """Consecutive days of activity counting back from today -- if nothing happened yet
    today, the streak still shows as alive (based on yesterday) rather than dropping to
    zero the instant the clock rolls into a new day; it only actually breaks once a full
    day passes with no activity at all."""
    if not dates:
        return 0
    if today not in dates and (today - timedelta(days=1)) not in dates:
        return 0

    streak = 0
    cursor = today if today in dates else today - timedelta(days=1)
    while cursor in dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


async def get_streak_days(db: AsyncSession, user_id: uuid.UUID, today: date | None = None) -> int:
    dates = await _activity_dates(db, user_id)
    return _streak_from_dates(dates, today or datetime.now(timezone.utc).date())


async def _count(db: AsyncSession, stmt) -> int:
    return (await db.execute(stmt)).scalar_one()


async def get_xp(db: AsyncSession, user_id: uuid.UUID) -> int:
    message_count = await _count(
        db,
        select(func.count())
        .select_from(ChatMessage)
        .join(ChatSession, ChatMessage.session_id == ChatSession.id)
        .where(ChatSession.user_id == user_id, ChatMessage.role == "user"),
    )
    review_count = await _count(
        db, select(func.count()).select_from(FlashcardReviewLog).where(FlashcardReviewLog.user_id == user_id)
    )
    plan_item_count = await _count(
        db, select(func.count()).select_from(StudyPlanItem).where(StudyPlanItem.user_id == user_id)
    )
    flashcard_count = await _count(
        db, select(func.count()).select_from(Flashcard).where(Flashcard.user_id == user_id)
    )

    return (
        message_count * XP_PER_USER_MESSAGE
        + review_count * XP_PER_FLASHCARD_REVIEW
        + plan_item_count * XP_PER_STUDY_PLAN_ITEM
        + flashcard_count * XP_PER_FLASHCARD_GENERATED
    )


def level_for_xp(xp: int) -> int:
    return 1 + xp // XP_PER_LEVEL


async def get_stats(db: AsyncSession, user_id: uuid.UUID) -> dict:
    streak = await get_streak_days(db, user_id)
    xp = await get_xp(db, user_id)
    return {
        "streak_days": streak,
        "xp": xp,
        "level": level_for_xp(xp),
        "xp_to_next_level": XP_PER_LEVEL - (xp % XP_PER_LEVEL),
    }
