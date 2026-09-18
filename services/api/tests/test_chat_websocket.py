import asyncio
import json
import uuid

import pytest
import websockets
from sqlalchemy import delete

from app.db.models import ChatMessage, ChatSession, Document, DocumentChunk, Flashcard
from app.routers import chat as chat_module

WS_BASE_URL = "ws://localhost:8000"


async def _authenticate(ws, token: str) -> None:
    """Sends the post-connect auth frame chat_ws now requires instead of a `?token=`
    query parameter (see app/routers/chat.py's chat_ws docstring for why -- the query
    string was leaking straight into access logs on every connection) and consumes the
    resulting "auth_ok" frame, so every test below can connect-and-auth in one line and
    get straight to the behavior it's actually testing."""
    await ws.send(json.dumps({"type": "auth", "token": token}))
    ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
    assert ack == {"type": "auth_ok"}


async def test_websocket_roundtrip_persists_messages(http_client, auth_headers, keycloak_token, db_session):
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session_id"]

    message = "hello newton, can you help me understand derivatives?"
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}"

    try:
        chunks: list[str] = []
        done_frame: dict = {}
        async with websockets.connect(uri) as ws:
            await _authenticate(ws, keycloak_token)
            await ws.send(json.dumps({"type": "user_message", "content": message}))

            while True:
                # Generous on purpose (not just per-chunk gaps, also the model's real
                # time-to-first-token, which can be genuinely slow rather than stuck).
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                frame = json.loads(raw)
                if frame["type"] == "done":
                    done_frame = frame
                    break
                if frame["type"] in ("user_message_saved", "tool_start", "tool_end", "plan_chunk"):
                    # A real model may genuinely reach for symbolic_math for a
                    # "derivatives" question — that's not what this test is about.
                    # user_message_saved (see chat_ws) always fires first, before any
                    # reply content, and plan_chunk (agents/tutor.py's PlanChunk) is a
                    # real, separately-tested optional preamble the model may or may not
                    # choose to emit before any reply -- also not what this test is
                    # about either way.
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

        # Same provider-agnostic stance for token usage: app/agents/tutor.py's
        # run_tutor always yields a UsageInfo on a normal (non-crisis) turn, so both
        # fields are always present integers here regardless of provider -- a real
        # OpenAI-compatible provider reports real positive counts; the keyless
        # EchoProvider (never an OpenAICompatibleProvider instance, so run_tutor's own
        # usage-accumulation branch never fires for it) reports exactly 0 for both,
        # never None. Only the crisis-response short-circuit (a different code path
        # entirely, covered by test_chat_websocket_crisis.py) hardcodes None instead.
        assert ("prompt_tokens" in done_frame) and ("completion_tokens" in done_frame)
        assert done_frame["prompt_tokens"] >= 0
        assert done_frame["completion_tokens"] >= 0

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


async def test_websocket_echoes_the_persisted_user_message_id(
    http_client, auth_headers, keycloak_token, db_session
):
    """Message editing (ROADMAP.md) needs a message's real id as its truncation-point
    identity, and the frontend must be able to offer "Edit" on the message a student
    JUST sent, not only on ones that survived a session reload -- see App.tsx's
    handling of the "user_message_saved" frame this asserts."""
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = create_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}"

    try:
        async with websockets.connect(uri) as ws:
            await _authenticate(ws, keycloak_token)
            await ws.send(json.dumps({"type": "user_message", "content": "what is a derivative?"}))

            # Must arrive before any reply content -- the message is persisted (and its
            # id known) before generation even starts.
            first = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            assert first["type"] == "user_message_saved"
            assert first["id"]

            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                if json.loads(raw)["type"] == "done":
                    break

        messages_resp = await http_client.get(
            f"/chat/sessions/{session_id}/messages", headers=auth_headers
        )
        persisted = messages_resp.json()
        assert persisted[0]["role"] == "user"
        assert persisted[0]["id"] == first["id"]
    finally:
        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_uuid))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.commit()


async def test_websocket_rejects_bad_token(http_client, auth_headers, db_session):
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = create_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}"

    try:
        # chat_ws accepts the handshake unconditionally, THEN expects the auth frame --
        # a bad token sent over it gets a real error frame and a 4401 close, so a client
        # can distinguish "bad token" from "session not found" (test below) instead of
        # both collapsing into an opaque 403 the way a query-param 422 would have.
        async with websockets.connect(uri) as ws:
            await ws.send(json.dumps({"type": "auth", "token": "not-a-real-token"}))
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


async def test_websocket_rejects_a_malformed_or_missing_auth_frame(keycloak_token):
    """Not just a bad token -- the FIRST frame not even being a well-formed
    {"type": "auth", "token": ...} at all (garbage, a different frame type, a token
    that isn't a string) must fail the same honest way, not hang waiting for something
    that looks more like an auth frame or crash trying to read a non-string token."""
    uri = f"{WS_BASE_URL}/chat/ws/{uuid.uuid4()}"

    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type": "user_message", "content": "hi"}))
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        assert json.loads(raw) == {"type": "error", "content": "invalid or expired token"}

        with pytest.raises(websockets.exceptions.ConnectionClosed) as exc_info:
            await asyncio.wait_for(ws.recv(), timeout=5)
        assert exc_info.value.rcvd.code == 4401


async def test_websocket_rejects_missing_session(keycloak_token):
    """A genuinely VALID token against a session that doesn't exist -- auth itself
    succeeds (decode_token has nothing to object to), so no "auth_ok" is ever sent; the
    very next frame is the session-not-found error, since that check only runs once
    auth has already passed. Doesn't use the _authenticate() helper for exactly that
    reason -- it asserts on "auth_ok" specifically, which never arrives on this path."""
    uri = f"{WS_BASE_URL}/chat/ws/{uuid.uuid4()}"

    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type": "auth", "token": keycloak_token}))
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        frame = json.loads(raw)
        assert frame == {"type": "error", "content": "session not found"}

        with pytest.raises(websockets.exceptions.ConnectionClosed) as exc_info:
            await asyncio.wait_for(ws.recv(), timeout=5)
        assert exc_info.value.rcvd.code == 4404


async def test_websocket_rejects_an_oversized_message_without_persisting_or_processing_it(
    http_client, auth_headers, keycloak_token, db_session
):
    """A pathological or compromised client sending a huge "content" must get a real,
    honest error instead of that text being persisted to chat_messages and pushed
    through the full tutor/RAG/tool-calling pipeline regardless of size -- see
    chat.py's own MAX_USER_MESSAGE_CHARS comment. Also proves the connection survives
    it and a normal-sized message right after still works, the same "never desyncs the
    protocol" bar every other no-op frame in this file is held to."""
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = create_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}"

    try:
        async with websockets.connect(uri) as ws:
            await _authenticate(ws, keycloak_token)

            oversized = "x" * (chat_module.MAX_USER_MESSAGE_CHARS + 1)
            await ws.send(json.dumps({"type": "user_message", "content": oversized}))
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            frame = json.loads(raw)
            assert frame["type"] == "error"
            assert "too long" in frame["content"]

            # The connection is still healthy -- a normal message right after still
            # gets a normal reply, proving the protocol never desynced.
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

        messages_resp = await http_client.get(
            f"/chat/sessions/{session_id}/messages", headers=auth_headers
        )
        persisted = messages_resp.json()
        # The oversized message was never persisted -- only the real, normal-sized one.
        assert len(persisted) == 2
        assert persisted[0]["content"] == "still there?"
    finally:
        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_uuid))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.commit()


async def test_websocket_stop_with_nothing_generating_is_a_harmless_noop(
    http_client, auth_headers, keycloak_token, db_session
):
    """A stray/late "stop" (e.g. a double-click, or one that arrives just after the
    reply already finished) must never error out the connection or desync the protocol
    — the very next real message should work normally."""
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = create_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}"

    try:
        async with websockets.connect(uri) as ws:
            await _authenticate(ws, keycloak_token)
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
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}"

    message = (
        "Please write at least fifteen distinct short sentences, each on its own line, "
        "each explaining a different real-world reason gravity matters."
    )

    try:
        async with websockets.connect(uri) as ws:
            await _authenticate(ws, keycloak_token)
            await ws.send(json.dumps({"type": "user_message", "content": message}))

            # user_message_saved always fires first, before any reply content -- skip
            # past it, and past an optional plan_chunk (see agents/tutor.py's own
            # PlanChunk -- a real, separately-tested preamble frame that fires before
            # the main answer whenever the model chooses to narrate a plan first, not
            # something specific to this request), to where proof generation has
            # actually started.
            first = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            assert first["type"] == "user_message_saved"
            first = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            if first["type"] == "plan_chunk":
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


async def test_websocket_ping_while_idle_gets_a_pong_and_stays_healthy(
    http_client, auth_headers, keycloak_token, db_session
):
    """Application-level keepalive (ROADMAP.md): the desktop client pings an otherwise-
    idle socket every ~20-25s specifically so real traffic keeps flowing and defeats any
    idle-timeout closure sitting on the network path. Also proves a ping never desyncs
    the protocol -- a real message right after still gets a normal reply, same
    "harmless no-op" bar test_websocket_stop_with_nothing_generating_is_a_harmless_noop
    holds "stop" to."""
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = create_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}"

    try:
        async with websockets.connect(uri) as ws:
            await _authenticate(ws, keycloak_token)
            await ws.send(json.dumps({"type": "ping"}))
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            assert json.loads(raw) == {"type": "pong"}

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


async def test_websocket_ping_mid_generation_is_a_harmless_noop(
    http_client, auth_headers, keycloak_token, db_session
):
    """A ping landing while a reply is still streaming (the recv/gen race loop, not the
    idle branch above) deliberately gets no explicit pong -- _drain_generation is already
    streaming real chunk frames concurrently on this same socket, which already satisfies
    the keepalive's purpose, and replying from the recv loop too would race
    _drain_generation's own concurrent sends (see chat.py's comment on this). This just
    proves it's never mistaken for a "stop" or a stray user_message -- the in-progress
    reply must still complete normally."""
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = create_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}"

    try:
        async with websockets.connect(uri) as ws:
            await _authenticate(ws, keycloak_token)
            await ws.send(json.dumps({"type": "user_message", "content": "what is a derivative?"}))

            # user_message_saved always fires first -- proof generation is underway.
            first = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            assert first["type"] == "user_message_saved"

            await ws.send(json.dumps({"type": "ping"}))

            saw_done = False
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                frame = json.loads(raw)
                assert frame["type"] != "pong"  # see the no-explicit-pong rationale above
                if frame["type"] == "done":
                    saw_done = True
                    break
            assert saw_done
    finally:
        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_uuid))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.commit()


@pytest.mark.live_smoke
async def test_websocket_sends_a_suggested_action_when_a_generation_tool_finishes(
    http_client, auth_headers, keycloak_token, db_session
):
    """The desktop app renders a real, clickable "Open Flashcards"-style button from
    this frame -- deterministic (keyed off which tool actually ran), not dependent on
    the model reliably mentioning it in its own reply text.

    Needs a real tool-calling-capable model actually deciding to call
    generate_flashcards -- the keyless EchoProvider (app/providers/echo.py) never calls
    tools at all by design, so this can only ever pass against a real deployed stack
    with OPENROUTER_API_KEY/GROQ_API_KEY configured, never the hermetic CI suite."""
    upload_resp = await http_client.post(
        "/documents/upload",
        headers=auth_headers,
        files={"file": ("ws-suggested-action.txt", b"Photosynthesis converts light into chemical energy.", "text/plain")},
    )
    assert upload_resp.status_code == 200, upload_resp.text
    document_id = uuid.UUID(upload_resp.json()["id"])

    session_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    session_id = session_resp.json()["session_id"]
    uri = f"{WS_BASE_URL}/chat/ws/{session_id}"

    try:
        async with websockets.connect(uri) as ws:
            await _authenticate(ws, keycloak_token)
            await ws.send(
                json.dumps(
                    {
                        "type": "user_message",
                        "content": "Please make me flashcards from ws-suggested-action.txt.",
                    }
                )
            )
            saw_tool_end = False
            saw_action: dict | None = None
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=45)
                frame = json.loads(raw)
                if frame["type"] == "tool_end" and frame.get("tool") == "generate_flashcards":
                    saw_tool_end = True
                if frame["type"] == "suggested_action":
                    saw_action = frame
                if frame["type"] == "done":
                    break

        assert saw_tool_end, "expected generate_flashcards to actually be called"
        assert saw_action == {"type": "suggested_action", "panel": "flashcards", "label": "Open Flashcards"}
    finally:
        session_uuid = uuid.UUID(session_id)
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_uuid))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_uuid))
        await db_session.execute(delete(Flashcard).where(Flashcard.document_id == document_id))
        await db_session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
        await db_session.execute(delete(Document).where(Document.id == document_id))
        await db_session.commit()
