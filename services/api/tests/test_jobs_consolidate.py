import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import delete, select

from app.db.base import SessionLocal
from app.db.models import ChatMessage, ChatSession, ProfileFact, SessionSummary, User
from app.jobs import consolidate
from app.memory import working
from tests.fakes import ScriptedToolCallingProvider

# ---------------------------------------------------------------------------
# app/jobs/consolidate.py's consolidate_session -- Tier 2 memory compaction. Verifies
# two things ROADMAP.md's periodic re-consolidation trigger (app/memory/working.py's
# CONSOLIDATION_INTERVAL_TURNS) depends on being true, neither of which mattered back
# when this job only ever ran once, at a real session's end:
#   1. Calling it a SECOND time for the same, still-growing session must not crash
#      (session_summaries.session_id is UNIQUE) and must update, not duplicate.
#   2. It must not wipe app/memory/working.py's Tier-1 bundle (the raw sliding
#      conversation window) any more -- that's the whole reason it stopped calling
#      working.invalidate() at the end.
# Profile-fact dedup safety itself is already covered end-to-end by
# tests/test_memory_profile.py's own upsert_fact tests; the second test below just
# confirms consolidate_session's own call site benefits from that, not re-deriving it.
# ---------------------------------------------------------------------------


def _summary_json(topic: str, fact_value: str | None = None) -> str:
    payload = {
        "topics": [topic],
        "problems_solved": [],
        "mistakes": [],
        "actions_taken": [],
        "profile_facts": (
            [{"subject_key": "skill:derivatives", "value": fact_value, "confidence": 0.9}]
            if fact_value
            else []
        ),
    }
    return json.dumps(payload)


@pytest_asyncio.fixture
async def throwaway_session(db_session):
    user = User(keycloak_sub=f"test-consolidate-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    session = ChatSession(user_id=user.id)
    db_session.add(session)
    await db_session.commit()

    yield user, session

    await db_session.execute(delete(ProfileFact).where(ProfileFact.user_id == user.id))
    await db_session.execute(delete(SessionSummary).where(SessionSummary.session_id == session.id))
    await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
    await db_session.execute(delete(ChatSession).where(ChatSession.id == session.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()
    await working.invalidate(str(session.id))


def _add_messages(db_session, session_id, pairs):
    # Explicit, strictly-increasing created_at per message rather than letting
    # Postgres' func.now() default apply -- messages added together and committed in
    # ONE transaction (as every call here does) would otherwise all land on the exact
    # same transaction-start timestamp, which app/memory/working.py's get_bundle
    # rehydration now relies on created_at to order correctly (see its own docstring).
    # Real production traffic never ties like this (app/routers/chat.py commits each
    # message in its own separate transaction), so this only matters for this bulk-
    # insert test helper's own artificial batching.
    base = datetime.now(timezone.utc)
    for i, (role, content) in enumerate(pairs):
        db_session.add(
            ChatMessage(
                session_id=session_id, role=role, content=content, created_at=base + timedelta(microseconds=i)
            )
        )


async def test_running_twice_on_a_growing_session_updates_the_summary_instead_of_crashing(
    db_session, throwaway_session, monkeypatch
):
    user, session = throwaway_session
    _add_messages(
        db_session,
        session.id,
        [("user", "What is a derivative?"), ("assistant", "The rate of change of a function.")],
    )
    await db_session.commit()

    fake = ScriptedToolCallingProvider([[_summary_json("derivatives")]])
    monkeypatch.setattr(consolidate, "get_provider", lambda **kwargs: (fake, "fake-model"))

    await consolidate.consolidate_session({}, str(session.id))

    summaries = (
        (await db_session.execute(select(SessionSummary).where(SessionSummary.session_id == session.id)))
        .scalars()
        .all()
    )
    assert len(summaries) == 1
    assert summaries[0].topics == ["derivatives"]

    # The session kept going -- more turns landed after the first consolidation.
    _add_messages(
        db_session,
        session.id,
        [("user", "What about integrals?"), ("assistant", "The reverse operation.")],
    )
    await db_session.commit()

    fake2 = ScriptedToolCallingProvider([[_summary_json("derivatives and integrals")]])
    monkeypatch.setattr(consolidate, "get_provider", lambda **kwargs: (fake2, "fake-model"))

    # Must not raise (session_summaries.session_id is UNIQUE) and must update the
    # SAME row rather than inserting a second one.
    await consolidate.consolidate_session({}, str(session.id))

    # consolidate_session commits through its own, separate SessionLocal() -- read back
    # through a FRESH session (not db_session, whose identity map still holds the row
    # from the first query above) so this genuinely reads what's in Postgres now.
    async with SessionLocal() as fresh_db:
        summaries = (
            (await fresh_db.execute(select(SessionSummary).where(SessionSummary.session_id == session.id)))
            .scalars()
            .all()
        )
    assert len(summaries) == 1, "a second run must update the existing row, not insert a duplicate"
    assert summaries[0].topics == ["derivatives and integrals"]


async def test_running_twice_reconfirms_rather_than_duplicates_a_profile_fact(
    db_session, throwaway_session, monkeypatch
):
    user, session = throwaway_session
    _add_messages(db_session, session.id, [("user", "I'm in MATH201"), ("assistant", "Got it.")])
    await db_session.commit()

    fake = ScriptedToolCallingProvider([[_summary_json("intro", fact_value="struggles with the chain rule")]])
    monkeypatch.setattr(consolidate, "get_provider", lambda **kwargs: (fake, "fake-model"))
    await consolidate.consolidate_session({}, str(session.id))

    fake2 = ScriptedToolCallingProvider([[_summary_json("intro", fact_value="struggles with the chain rule")]])
    monkeypatch.setattr(consolidate, "get_provider", lambda **kwargs: (fake2, "fake-model"))
    await consolidate.consolidate_session({}, str(session.id))

    facts = (
        (
            await db_session.execute(
                select(ProfileFact).where(
                    ProfileFact.user_id == user.id, ProfileFact.superseded_by.is_(None)
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(facts) == 1, "the same fact reported twice must reconfirm, not duplicate"
    assert facts[0].value == "struggles with the chain rule"


async def test_consolidate_session_does_not_wipe_the_tier1_working_memory_bundle(
    db_session, throwaway_session, monkeypatch
):
    """The regression this is guarding against: consolidate_session used to call
    working.invalidate() unconditionally, which is fine at a real session's end but
    would force an unnecessary Postgres rehydration (see get_bundle's cold-start
    rehydration, added separately) of the model's whole recent-conversation context if
    it fired mid-conversation, which it now does (see ROADMAP.md)."""
    user, session = throwaway_session
    _add_messages(db_session, session.id, [("user", "hi"), ("assistant", "hello")])
    await db_session.commit()

    await working.append_turn(str(session.id), "user", "hi")
    await working.append_turn(str(session.id), "assistant", "hello")

    fake = ScriptedToolCallingProvider([[_summary_json("greeting")]])
    monkeypatch.setattr(consolidate, "get_provider", lambda **kwargs: (fake, "fake-model"))

    await consolidate.consolidate_session({}, str(session.id))

    bundle = await working.get_bundle(str(session.id))
    assert bundle["turns"] == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]
