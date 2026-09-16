import uuid

import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import ChatMessage, ChatSession, User

# Message editing (ROADMAP.md): DELETE /chat/sessions/{session_id}/messages/{message_id}
# deletes that message and everything after it (by creation order) in the same session.
# See app/routers/chat.py's delete_message_and_after for the real implementation this
# exercises.


async def _create_session(http_client, auth_headers) -> str:
    resp = await http_client.post("/chat/sessions", headers=auth_headers)
    assert resp.status_code == 200
    return resp.json()["session_id"]


async def _seed_messages(db_session, session_id: str, turns: list[tuple[str, str]]) -> list[uuid.UUID]:
    """Inserts messages one at a time (each its own commit) so `created_at` -- a
    server_default(func.now()) column -- actually orders them distinctly, the same way
    the real WS handler persists a user message and its reply as two separate commits
    rather than one batch insert."""
    ids: list[uuid.UUID] = []
    for role, content in turns:
        msg = ChatMessage(session_id=uuid.UUID(session_id), role=role, content=content)
        db_session.add(msg)
        await db_session.commit()
        await db_session.refresh(msg)
        ids.append(msg.id)
    return ids


async def test_list_messages_exposes_a_real_id(http_client, auth_headers, db_session, created_session_ids):
    session_id = await _create_session(http_client, auth_headers)
    created_session_ids.append(uuid.UUID(session_id))
    ids = await _seed_messages(db_session, session_id, [("user", "hello")])

    resp = await http_client.get(f"/chat/sessions/{session_id}/messages", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == str(ids[0])


async def test_delete_message_and_after_requires_auth(http_client):
    resp = await http_client.delete(f"/chat/sessions/{uuid.uuid4()}/messages/{uuid.uuid4()}")
    assert resp.status_code == 401


async def test_delete_message_removes_target_and_everything_after_but_not_before(
    http_client, auth_headers, db_session, created_session_ids
):
    session_id = await _create_session(http_client, auth_headers)
    created_session_ids.append(uuid.UUID(session_id))
    ids = await _seed_messages(
        db_session,
        session_id,
        [
            ("user", "first question"),
            ("assistant", "first answer"),
            ("user", "second question -- this is the one being edited"),
            ("assistant", "second answer, about to be discarded"),
        ],
    )
    edited_id = ids[2]

    resp = await http_client.delete(
        f"/chat/sessions/{session_id}/messages/{edited_id}", headers=auth_headers
    )
    assert resp.status_code == 204

    remaining = (
        await db_session.execute(
            select(ChatMessage).where(ChatMessage.session_id == uuid.UUID(session_id)).order_by(ChatMessage.created_at)
        )
    ).scalars().all()
    assert [m.content for m in remaining] == ["first question", "first answer"]
    # Nothing before the edited message was touched.
    assert remaining[0].id == ids[0]
    assert remaining[1].id == ids[1]


async def test_delete_message_404_for_missing_session(http_client, auth_headers):
    resp = await http_client.delete(
        f"/chat/sessions/{uuid.uuid4()}/messages/{uuid.uuid4()}", headers=auth_headers
    )
    assert resp.status_code == 404


async def test_delete_message_404_for_message_not_in_that_session(
    http_client, auth_headers, db_session, created_session_ids
):
    session_a = await _create_session(http_client, auth_headers)
    session_b = await _create_session(http_client, auth_headers)
    created_session_ids.append(uuid.UUID(session_a))
    created_session_ids.append(uuid.UUID(session_b))
    ids_b = await _seed_messages(db_session, session_b, [("user", "lives in session b")])

    # message_id is real, but belongs to a different (also-owned) session -- must still
    # 404 rather than reach across sessions.
    resp = await http_client.delete(
        f"/chat/sessions/{session_a}/messages/{ids_b[0]}", headers=auth_headers
    )
    assert resp.status_code == 404

    still_there = await db_session.get(ChatMessage, ids_b[0])
    assert still_there is not None


@pytest_asyncio.fixture
async def someone_elses_session(db_session):
    """A session (with one message) owned by a throwaway user who is NOT the
    authenticated test account (auth_headers always logs in as student1) -- for
    asserting the ownership check, mirroring test_documents.py's someone_elses_document
    fixture."""
    user = User(keycloak_sub=f"test-chat-edit-owner-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    session = ChatSession(user_id=user.id)
    db_session.add(session)
    await db_session.flush()

    message = ChatMessage(session_id=session.id, role="user", content="not yours")
    db_session.add(message)
    await db_session.flush()
    await db_session.commit()

    yield session, message

    await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
    await db_session.execute(delete(ChatSession).where(ChatSession.id == session.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_delete_message_404_for_another_users_session(
    someone_elses_session, http_client, auth_headers, db_session
):
    session, message = someone_elses_session
    resp = await http_client.delete(
        f"/chat/sessions/{session.id}/messages/{message.id}", headers=auth_headers
    )
    assert resp.status_code == 404

    # Ownership check must be enforced BEFORE any deletion happens -- the foreign
    # message must still be there afterward.
    still_there = await db_session.get(ChatMessage, message.id)
    assert still_there is not None
