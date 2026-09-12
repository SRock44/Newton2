import uuid

import pytest_asyncio
from sqlalchemy import delete

from app.db.models import ChatMessage, ChatSession


@pytest_asyncio.fixture
async def created_session_ids(db_session):
    """Tracks session ids created during a test so we can wipe them (and any
    messages) afterward and not leave junk in the shared dev database."""
    ids: list[uuid.UUID] = []
    yield ids
    for session_id in ids:
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_id))
    await db_session.commit()


async def test_create_list_and_end_session(http_client, auth_headers, created_session_ids):
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session_id"]
    created_session_ids.append(uuid.UUID(session_id))

    list_resp = await http_client.get("/chat/sessions", headers=auth_headers)
    assert list_resp.status_code == 200
    listed_ids = [s["id"] for s in list_resp.json()]
    assert session_id in listed_ids

    matching = next(s for s in list_resp.json() if s["id"] == session_id)
    assert matching["status"] == "active"

    end_resp = await http_client.post(f"/chat/sessions/{session_id}/end", headers=auth_headers)
    assert end_resp.status_code == 200
    body = end_resp.json()
    assert body["status"] == "ended"


async def test_messages_endpoint_404_for_foreign_or_missing_session(http_client, auth_headers):
    bogus_id = uuid.uuid4()
    resp = await http_client.get(f"/chat/sessions/{bogus_id}/messages", headers=auth_headers)
    assert resp.status_code == 404
