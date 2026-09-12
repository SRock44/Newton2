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
                # Generous on purpose (not just per-chunk gaps, also the model's real
                # time-to-first-token, which can be genuinely slow rather than stuck).
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                frame = json.loads(raw)
                if frame["type"] == "done":
                    break
                assert frame["type"] == "chunk", frame
                chunks.append(frame["content"])

        full_response = "".join(chunks)
        # Deliberately provider-agnostic: this environment may have a real model key
        # configured (in which case the reply is genuine, not an echo), or may not (the
        # keyless EchoProvider — see test_providers.py for assertions specific to that
        # provider's own behavior, tested in isolation rather than through the live
        # server). Either way, a real, non-empty reply must come back and persist.
        assert full_response

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
        # chat_ws accepts the handshake first, then sends a real error frame and
        # closes with 4401 — a client can distinguish "bad token" from "session not
        # found" (test below) instead of both collapsing into an opaque 403.
        async with websockets.connect(uri) as ws:
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            frame = json.loads(raw)
            assert frame == {"type": "error", "content": "invalid or expired token"}

            with pytest.raises(websockets.exceptions.ConnectionClosed) as exc_info:
                await asyncio.wait_for(ws.recv(), timeout=5)
            assert exc_info.value.rcvd.code == 4401
    finally:
        # No messages were ever added to this session; just drop the session row.
        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.commit()


async def test_websocket_rejects_missing_session(keycloak_token):
    uri = f"{WS_BASE_URL}/chat/ws/{uuid.uuid4()}?token={keycloak_token}"

    async with websockets.connect(uri) as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        frame = json.loads(raw)
        assert frame == {"type": "error", "content": "session not found"}

        with pytest.raises(websockets.exceptions.ConnectionClosed) as exc_info:
            await asyncio.wait_for(ws.recv(), timeout=5)
        assert exc_info.value.rcvd.code == 4404
