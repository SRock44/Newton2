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
        done_frame: dict = {}
        async with websockets.connect(uri) as ws:
            await ws.send(json.dumps({"type": "user_message", "content": message}))

            while True:
                # Generous on purpose (not just per-chunk gaps, also the model's real
                # time-to-first-token, which can be genuinely slow rather than stuck).
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                frame = json.loads(raw)
                if frame["type"] == "done":
                    done_frame = frame
                    break
                if frame["type"] in ("tool_start", "tool_end"):
                    # A real model may genuinely reach for symbolic_math for a
                    # "derivatives" question — that's not what this test is about.
                    continue
                assert frame["type"] == "chunk", frame
                chunks.append(frame["content"])

        full_response = "".join(chunks)
        # Deliberately provider-agnostic: this environment may have a real model key
        # configured (in which case the reply is genuine, not an echo), or may not (the
        # keyless EchoProvider — see test_providers.py for assertions specific to that
        # provider's own behavior, tested in isolation rather than through the live
        # server). Either way, a real, non-empty reply must come back and persist.
        assert full_response

        # Same provider-agnostic stance for token usage: a real OpenAI-compatible
        # provider reports it (both fields present and positive); the keyless
        # EchoProvider doesn't report usage at all (both None) — either is valid, but
        # they must be consistent with each other, never one present and one missing.
        assert ("prompt_tokens" in done_frame) and ("completion_tokens" in done_frame)
        has_usage = done_frame["prompt_tokens"] is not None
        assert has_usage == (done_frame["completion_tokens"] is not None)
        if has_usage:
            assert done_frame["prompt_tokens"] > 0
            assert done_frame["completion_tokens"] > 0

        messages_resp = await http_client.get(
            f"/chat/sessions/{session_id}/messages", headers=auth_headers
        )
        assert messages_resp.status_code == 200
        persisted = messages_resp.json()
        assert len(persisted) == 2

        assert persisted[0]["role"] == "user"
        assert persisted[0]["content"] == message
        assert persisted[0]["prompt_tokens"] is None  # only ever tracked on assistant replies

        assert persisted[1]["role"] == "assistant"
        assert persisted[1]["content"] == full_response
        # The persisted row must match exactly what the "done" frame already told the
        # client — no separate, potentially-diverging source of truth.
        assert persisted[1]["prompt_tokens"] == done_frame["prompt_tokens"]
        assert persisted[1]["completion_tokens"] == done_frame["completion_tokens"]
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


async def test_websocket_stop_with_nothing_generating_is_a_harmless_noop(
    http_client, auth_headers, keycloak_token, db_session
):
    """A stray/late "stop" (e.g. a double-click, or one that arrives just after the
    reply already finished) must never error out the connection or desync the protocol
    — the very next real message should work normally."""
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = create_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}?token={keycloak_token}"

    try:
        async with websockets.connect(uri) as ws:
            await ws.send(json.dumps({"type": "stop"}))

            # Prove the connection is still healthy and the protocol didn't desync:
            # a real message right after still gets a normal reply.
            await ws.send(json.dumps({"type": "user_message", "content": "still there?"}))
            saw_chunk_or_done = False
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                frame = json.loads(raw)
                if frame["type"] == "done":
                    saw_chunk_or_done = True
                    break
                if frame["type"] in ("chunk", "tool_start", "tool_end"):
                    saw_chunk_or_done = True
            assert saw_chunk_or_done
    finally:
        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_uuid))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.commit()


async def test_websocket_stop_mid_generation_truncates_and_persists_partial(
    http_client, auth_headers, keycloak_token, db_session
):
    """Best-effort against a live provider (real or Echo): react to the very first
    chunk instead of sleeping a fixed delay, so this isn't racing a guessed timing —
    it sends "stop" as soon as there's proof generation has actually started."""
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = create_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}?token={keycloak_token}"

    message = (
        "Please write at least fifteen distinct short sentences, each on its own line, "
        "each explaining a different real-world reason gravity matters."
    )

    try:
        async with websockets.connect(uri) as ws:
            await ws.send(json.dumps({"type": "user_message", "content": message}))

            first = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            assert first["type"] in ("chunk", "tool_start")
            await ws.send(json.dumps({"type": "stop"}))

            saw_stopped = False
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                frame = json.loads(raw)
                if frame["type"] == "stopped":
                    saw_stopped = True
                    break
                if frame["type"] == "done":
                    # Generation finished before our stop was processed server-side —
                    # legitimate under a very fast provider; nothing to assert further.
                    break

            messages_resp = await http_client.get(
                f"/chat/sessions/{session_id}/messages", headers=auth_headers
            )
            persisted = messages_resp.json()
            assert len(persisted) == 2
            assert persisted[1]["role"] == "assistant"
            if saw_stopped:
                # Whatever text streamed before the stop was seen must still be
                # persisted, not silently dropped.
                assert persisted[1]["content"] != ""
    finally:
        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_uuid))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.commit()
