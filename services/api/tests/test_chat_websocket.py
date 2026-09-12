import asyncio
import json
import uuid

import pytest
import websockets
from sqlalchemy import delete

from app.db.models import ChatMessage, ChatSession

WS_BASE_URL = "ws://localhost:8000"


async def test_websocket_roundtrip_persists_messages(http_client, auth_headers, keycloak_token, db_session):
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session_id"]

    message = "hello newton, can you help me understand derivatives?"
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}?token={keycloak_token}"

    try:
        chunks: list[str] = []
        async with websockets.connect(uri) as ws:
            await ws.send(message)

            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
                frame = json.loads(raw)
                if frame["type"] == "done":
                    break
                assert frame["type"] == "chunk", frame
                chunks.append(frame["content"])

        full_response = "".join(chunks)
        assert full_response  # the echo provider always yields something
        assert f"you said: {message}" in full_response

        messages_resp = await http_client.get(
            f"/chat/sessions/{session_id}/messages", headers=auth_headers
        )
        assert messages_resp.status_code == 200
        persisted = messages_resp.json()
        assert len(persisted) == 2

        assert persisted[0]["role"] == "user"
        assert persisted[0]["content"] == message

        assert persisted[1]["role"] == "assistant"
        assert persisted[1]["content"] == full_response
    finally:
        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_uuid))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.commit()


async def test_websocket_rejects_bad_token(http_client, auth_headers, db_session):
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = create_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}?token=not-a-real-token"

    try:
        # NOTE: chat_ws calls `await websocket.close(code=4401)` on an invalid token
        # *before* ever calling `websocket.accept()`. Starlette/uvicorn turn a close()
        # issued pre-accept into a bare HTTP-level handshake rejection (403) rather than
        # a completed WS handshake followed by a close frame — so the custom 4401 code
        # never actually reaches a client. This asserts the real observed behavior
        # (403), not the code's apparent intent; see the test run report for details.
        with pytest.raises(websockets.exceptions.InvalidStatus) as exc_info:
            async with websockets.connect(uri):
                pass
        assert exc_info.value.response.status_code == 403
    finally:
        # No messages were ever added to this session; just drop the session row.
        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.commit()
