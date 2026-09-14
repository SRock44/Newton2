import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import delete

from app.db.models import ChatSession, User
from app.jobs.retention import INACTIVITY_THRESHOLD_DAYS, find_inactive_accounts

# ---------------------------------------------------------------------------
# find_inactive_accounts -- the real selection logic behind the weekly
# report_inactive_accounts arq job (app/jobs/retention.py). All assertions use an
# explicit, fixed `now` so results are deterministic regardless of when the suite
# actually runs, and every user/session created here is a disposable throwaway (never
# student1), cleaned up afterward like test_account.py's fixtures.
# ---------------------------------------------------------------------------

NOW = datetime(2026, 9, 14, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def retention_users(db_session):
    """Four throwaway users covering the real decision boundaries:
    - recently_active: a session well inside the threshold -> never flagged.
    - long_inactive: a session well past the threshold -> flagged.
    - never_active_old: no sessions at all, but signed up long ago -> flagged off
      users.created_at.
    - never_active_new: no sessions, signed up recently -> not flagged.
    """
    users = {
        "recently_active": User(keycloak_sub=f"test-retention-{uuid.uuid4()}", created_at=NOW - timedelta(days=800)),
        "long_inactive": User(keycloak_sub=f"test-retention-{uuid.uuid4()}", created_at=NOW - timedelta(days=800)),
        "never_active_old": User(keycloak_sub=f"test-retention-{uuid.uuid4()}", created_at=NOW - timedelta(days=600)),
        "never_active_new": User(keycloak_sub=f"test-retention-{uuid.uuid4()}", created_at=NOW - timedelta(days=5)),
    }
    for user in users.values():
        db_session.add(user)
    await db_session.flush()

    db_session.add(
        ChatSession(
            user_id=users["recently_active"].id,
            title="recent",
            created_at=NOW - timedelta(days=10),
        )
    )
    db_session.add(
        ChatSession(
            user_id=users["long_inactive"].id,
            title="stale",
            created_at=NOW - timedelta(days=INACTIVITY_THRESHOLD_DAYS + 30),
        )
    )
    # long_inactive also has an OLDER session -- proves the query takes the MOST
    # RECENT session, not just any session, as "last active."
    db_session.add(
        ChatSession(
            user_id=users["long_inactive"].id,
            title="even older",
            created_at=NOW - timedelta(days=INACTIVITY_THRESHOLD_DAYS + 200),
        )
    )
    await db_session.commit()

    yield users

    for user in users.values():
        await db_session.execute(delete(ChatSession).where(ChatSession.user_id == user.id))
        await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_recently_active_account_is_not_flagged(db_session, retention_users):
    flagged = await find_inactive_accounts(db_session, now=NOW)
    flagged_ids = {row["user_id"] for row in flagged}
    assert str(retention_users["recently_active"].id) not in flagged_ids


async def test_long_inactive_account_is_flagged_using_its_most_recent_session(db_session, retention_users):
    flagged = await find_inactive_accounts(db_session, now=NOW)
    by_id = {row["user_id"]: row for row in flagged}
    user_id = str(retention_users["long_inactive"].id)

    assert user_id in by_id
    assert by_id[user_id]["days_inactive"] == INACTIVITY_THRESHOLD_DAYS + 30
    # PII-conscious: the report carries a boolean, never the address itself.
    assert by_id[user_id]["has_email"] is False


async def test_account_with_no_sessions_ever_falls_back_to_created_at(db_session, retention_users):
    flagged = await find_inactive_accounts(db_session, now=NOW)
    flagged_ids = {row["user_id"] for row in flagged}

    assert str(retention_users["never_active_old"].id) in flagged_ids
    assert str(retention_users["never_active_new"].id) not in flagged_ids


async def test_threshold_is_configurable_per_call(db_session, retention_users):
    # A much longer threshold should un-flag the account that only just cleared the
    # default one -- proves threshold_days is a real, honored parameter, not a
    # decoration over a hardcoded cutoff.
    flagged = await find_inactive_accounts(db_session, now=NOW, threshold_days=10_000)
    flagged_ids = {row["user_id"] for row in flagged}
    assert str(retention_users["long_inactive"].id) not in flagged_ids
