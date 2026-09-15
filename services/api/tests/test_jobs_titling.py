import uuid

import pytest_asyncio
from sqlalchemy import delete

from app.db.models import ChatMessage, ChatSession, User
from app.jobs import titling
from tests.fakes import ScriptedToolCallingProvider

# ---------------------------------------------------------------------------
# app/jobs/titling.py's generate_session_title -- modeled on consolidate_session's own
# shape (SessionLocal, a small transcript, one cheap get_provider() call, parse/clean,
# write back). throwaway_session below never touches student1, cleaned up afterward
# like every other DB-backed fixture in this suite.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_session(db_session):
    user = User(keycloak_sub=f"test-titling-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    session = ChatSession(user_id=user.id)
    db_session.add(session)
    await db_session.commit()

    yield session

    await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
    await db_session.execute(delete(ChatSession).where(ChatSession.id == session.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


def _add_messages(db_session, session_id, pairs):
    for role, content in pairs:
        db_session.add(ChatMessage(session_id=session_id, role=role, content=content))


async def test_generates_and_writes_a_title_for_a_real_session_with_messages(
    db_session, throwaway_session, monkeypatch
):
    _add_messages(
        db_session,
        throwaway_session.id,
        [
            ("user", "Can you help me understand derivatives?"),
            ("assistant", "Sure -- a derivative measures how a function changes."),
        ],
    )
    await db_session.commit()

    fake = ScriptedToolCallingProvider([["Understanding Derivatives Basics"]])
    monkeypatch.setattr(titling, "get_provider", lambda **kwargs: (fake, "fake-model"))

    await titling.generate_session_title({}, str(throwaway_session.id))

    await db_session.refresh(throwaway_session)
    assert throwaway_session.title == "Understanding Derivatives Basics"


async def test_noops_if_title_already_set(db_session, throwaway_session, monkeypatch):
    throwaway_session.title = "Existing Title"
    await db_session.commit()

    _add_messages(db_session, throwaway_session.id, [("user", "hello"), ("assistant", "hi there")])
    await db_session.commit()

    fake = ScriptedToolCallingProvider([["A Totally Different Title"]])
    monkeypatch.setattr(titling, "get_provider", lambda **kwargs: (fake, "fake-model"))

    await titling.generate_session_title({}, str(throwaway_session.id))

    await db_session.refresh(throwaway_session)
    assert throwaway_session.title == "Existing Title"
    assert fake.calls_seen == [], "get_provider must never even be called once a title exists"


async def test_noops_for_a_session_with_no_messages(db_session, throwaway_session, monkeypatch):
    fake = ScriptedToolCallingProvider([["Should Never Be Used"]])
    monkeypatch.setattr(titling, "get_provider", lambda **kwargs: (fake, "fake-model"))

    await titling.generate_session_title({}, str(throwaway_session.id))

    await db_session.refresh(throwaway_session)
    assert throwaway_session.title is None


async def test_noops_for_an_unknown_session_id():
    # Must never raise just because the session vanished (e.g. deleted) between
    # enqueue and the job actually running.
    await titling.generate_session_title({}, str(uuid.uuid4()))


async def test_cleans_a_title_that_ignores_the_no_prefix_no_quotes_instruction(
    db_session, throwaway_session, monkeypatch
):
    _add_messages(db_session, throwaway_session.id, [("user", "hi"), ("assistant", "hello")])
    await db_session.commit()

    fake = ScriptedToolCallingProvider([['Title: "Friendly Chat About Greetings"\n']])
    monkeypatch.setattr(titling, "get_provider", lambda **kwargs: (fake, "fake-model"))

    await titling.generate_session_title({}, str(throwaway_session.id))

    await db_session.refresh(throwaway_session)
    assert throwaway_session.title == "Friendly Chat About Greetings"


async def test_truncates_an_overly_long_title(db_session, throwaway_session, monkeypatch):
    _add_messages(db_session, throwaway_session.id, [("user", "hi"), ("assistant", "hello")])
    await db_session.commit()

    long_title = "A" * 120
    fake = ScriptedToolCallingProvider([[long_title]])
    monkeypatch.setattr(titling, "get_provider", lambda **kwargs: (fake, "fake-model"))

    await titling.generate_session_title({}, str(throwaway_session.id))

    await db_session.refresh(throwaway_session)
    assert throwaway_session.title is not None
    assert len(throwaway_session.title) <= titling.MAX_TITLE_LENGTH


def test_clean_title_strips_prefix_quotes_and_collapses_whitespace():
    assert titling._clean_title('Title: "Chain Rule Practice"') == "Chain Rule Practice"
    assert titling._clean_title("  Photosynthesis   Basics  \n") == "Photosynthesis Basics"
    assert titling._clean_title("'Quoted Title'") == "Quoted Title"
