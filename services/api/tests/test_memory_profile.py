import uuid

import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import ProfileFact, User
from app.memory import profile as profile_memory


@pytest_asyncio.fixture
async def throwaway_user(db_session):
    """A disposable user row, independent of the Keycloak-backed student1 account,
    so profile-fact tests don't collide with (or pollute) anything else touching
    that user."""
    user = User(keycloak_sub=f"test-profile-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.commit()
    yield user
    await db_session.execute(delete(ProfileFact).where(ProfileFact.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def _current_rows(db_session, user_id, subject_key) -> list[ProfileFact]:
    result = await db_session.execute(
        select(ProfileFact).where(
            ProfileFact.user_id == user_id,
            ProfileFact.subject_key == subject_key,
        )
    )
    return list(result.scalars())


async def test_upsert_fact_supersedes_old_row_on_new_value(db_session, throwaway_user):
    subject_key = "course:MATH201"

    first = await profile_memory.upsert_fact(
        db_session, throwaway_user.id, subject_key, "struggling with derivatives"
    )
    await db_session.commit()

    second = await profile_memory.upsert_fact(
        db_session, throwaway_user.id, subject_key, "comfortable with derivatives now"
    )
    await db_session.commit()

    rows = await _current_rows(db_session, throwaway_user.id, subject_key)
    assert len(rows) == 2, "expected exactly the original row plus its replacement, not a third"

    current = [r for r in rows if r.superseded_by is None]
    assert len(current) == 1, "exactly one *current* row must exist per (user, subject_key)"
    assert current[0].id == second.id
    assert current[0].value == "comfortable with derivatives now"

    superseded = [r for r in rows if r.superseded_by is not None]
    assert len(superseded) == 1
    assert superseded[0].id == first.id
    assert superseded[0].superseded_by == second.id


async def test_upsert_fact_same_value_reconfirms_without_new_row(db_session, throwaway_user):
    subject_key = "pref:learning_style"

    first = await profile_memory.upsert_fact(db_session, throwaway_user.id, subject_key, "visual")
    await db_session.commit()

    second = await profile_memory.upsert_fact(db_session, throwaway_user.id, subject_key, "visual")
    await db_session.commit()

    assert second.id == first.id, "reconfirming the same value should return the existing row, not a new one"

    rows = await _current_rows(db_session, throwaway_user.id, subject_key)
    assert len(rows) == 1
    assert rows[0].superseded_by is None
