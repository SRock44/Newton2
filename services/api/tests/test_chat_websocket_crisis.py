"""WS-handler integration tests for the crisis-response safety net wired into
app/routers/chat.py's `chat_ws` (see app/core/crisis_detection.py for the detection
mechanism itself, tested in isolation in tests/test_crisis_detection.py).

Unlike the rest of tests/test_chat_websocket.py, this deliberately does NOT go through
the live server on ws://localhost:8000 -- proving "the normal tutor/provider pipeline is
never invoked for a crisis turn" requires monkeypatching `app.routers.chat.run_tutor`,
which only affects the pytest process itself, not the separately-running uvicorn
process the live-server tests talk to (see test_chat_websocket.py's docstring context
for that split). Instead, `chat_ws` -- a plain async function -- is invoked directly
in-process against a minimal fake WebSocket double that implements just the
accept/receive_text/send_json/close surface it actually uses. Everything else (DB via
the real SessionLocal, real Keycloak token verification, real working-memory bundle) is
the real thing, same as every other test in this suite that touches the DB directly.
"""

import json
import logging
import uuid

import pytest
from fastapi import WebSocketDisconnect
from sqlalchemy import delete, select

from app.agents.tutor import TextChunk, UsageInfo
from app.core.crisis_detection import CRISIS_RESPONSE_TEXT
from app.db.models import ChatMessage, ChatSession
from app.routers import chat as chat_module


class FakeWebSocket:
    """Implements just the surface `chat_ws` actually calls on a WebSocket: accept(),
    receive_text() (scripted from a fixed list of frames, then raises
    WebSocketDisconnect once exhausted -- exactly what a client closing the connection
    looks like from the server's side), send_json() (recorded for assertions), and
    close()."""

    def __init__(self, incoming_frames: list[dict]):
        self._incoming = [json.dumps(f) for f in incoming_frames]
        self.sent: list[dict] = []
        self.closed_code: int | None = None

    async def accept(self) -> None:
        return None

    async def receive_text(self) -> str:
        if not self._incoming:
            raise WebSocketDisconnect()
        return self._incoming.pop(0)

    async def send_json(self, data: dict) -> None:
        self.sent.append(data)

    async def close(self, code: int = 1000) -> None:
        self.closed_code = code


@pytest.fixture
async def crisis_session(http_client, auth_headers, db_session):
    """A real chat session (and its owning user row, created via the same
    get_or_create_user path the live endpoints use) to run chat_ws against directly."""
    create_resp = await http_client.post("/chat/sessions", headers=auth_headers)
    assert create_resp.status_code == 200
    session_id = uuid.UUID(create_resp.json()["session_id"])
    try:
        yield session_id
    finally:
        await db_session.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
        await db_session.execute(delete(ChatSession).where(ChatSession.id == session_id))
        await db_session.commit()


async def _persisted_messages(db_session, session_id: uuid.UUID) -> list[ChatMessage]:
    rows = (
        (
            await db_session.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session_id)
                .order_by(ChatMessage.created_at)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def test_crisis_message_gets_fixed_response_and_skips_the_tutor_entirely(
    crisis_session, keycloak_token, db_session, monkeypatch, caplog
):
    session_id = crisis_session

    tutor_calls: list[str] = []

    async def fake_run_tutor(session_id_arg, user_message, **kwargs):
        # Should never actually be reached for the crisis turn -- if it is, the test
        # below asserting tutor_calls == [] catches it. Still a well-formed generator
        # (never called for real here) so nothing breaks if it somehow were invoked.
        tutor_calls.append(user_message)
        yield TextChunk("this should never be sent")
        yield UsageInfo(prompt_tokens=1, completion_tokens=1)

    sentry_calls: list[BaseException] = []
    monkeypatch.setattr(chat_module, "run_tutor", fake_run_tutor)
    monkeypatch.setattr(chat_module, "report_exception", lambda exc: sentry_calls.append(exc))

    ws = FakeWebSocket([{"type": "user_message", "content": "i want to kill myself"}])

    with caplog.at_level(logging.WARNING, logger="newton.chat"):
        await chat_module.chat_ws(ws, session_id, keycloak_token)

    # The tutor/provider pipeline was never invoked for this turn.
    assert tutor_calls == []

    # The exact fixed text streamed back, verbatim, through the same "chunk"/"done"
    # frame types a normal reply uses.
    chunk_frames = [f for f in ws.sent if f["type"] == "chunk"]
    assert len(chunk_frames) == 1
    assert chunk_frames[0]["content"] == CRISIS_RESPONSE_TEXT

    done_frames = [f for f in ws.sent if f["type"] == "done"]
    assert len(done_frames) == 1
    assert done_frames[0]["prompt_tokens"] is None
    assert done_frames[0]["completion_tokens"] is None

    # No tool_start/tool_end/suggested_action/error frames -- nothing tutor-shaped.
    # (user_message_saved always fires first, right after the user turn is persisted --
    # see chat_ws's own comment -- independent of the crisis short-circuit.)
    assert {f["type"] for f in ws.sent} == {"user_message_saved", "chunk", "done"}

    # Persisted to chat_messages exactly like any other turn: one user row, one
    # assistant row with the fixed text verbatim.
    persisted = await _persisted_messages(db_session, session_id)
    assert len(persisted) == 2
    assert persisted[0].role == "user"
    assert persisted[0].content == "i want to kill myself"
    assert persisted[1].role == "assistant"
    assert persisted[1].content == CRISIS_RESPONSE_TEXT
    assert persisted[1].prompt_tokens is None
    assert persisted[1].completion_tokens is None

    # Logged at WARNING, without the raw triggering message text anywhere in the log
    # line -- the message itself is already in chat_messages; the log line should carry
    # session_id/user_id/category only.
    warning_records = [r for r in caplog.records if r.levelno == logging.WARNING]
    crisis_records = [r for r in warning_records if "crisis pattern detected" in r.message]
    assert len(crisis_records) == 1
    assert str(session_id) in crisis_records[0].message
    assert "i want to kill myself" not in crisis_records[0].message

    # Never reported to Sentry -- this is an intentional safety response, not an
    # application error.
    assert sentry_calls == []


async def test_normal_message_after_a_crisis_turn_still_gets_a_normal_tutor_reply(
    crisis_session, keycloak_token, db_session, monkeypatch
):
    """The crisis short-circuit must not end the conversation or desync the protocol --
    the very next ordinary message on the same connection is routed through run_tutor
    normally."""
    session_id = crisis_session

    tutor_calls: list[str] = []

    async def fake_run_tutor(session_id_arg, user_message, **kwargs):
        tutor_calls.append(user_message)
        yield TextChunk("The answer is 4.")
        yield UsageInfo(prompt_tokens=5, completion_tokens=3)

    monkeypatch.setattr(chat_module, "run_tutor", fake_run_tutor)

    ws = FakeWebSocket(
        [
            {"type": "user_message", "content": "i want to kill myself"},
            {"type": "user_message", "content": "what's 2+2?"},
        ]
    )

    await chat_module.chat_ws(ws, session_id, keycloak_token)

    # run_tutor was invoked exactly once, and only for the second (ordinary) message.
    assert tutor_calls == ["what's 2+2?"]

    done_frames = [f for f in ws.sent if f["type"] == "done"]
    assert len(done_frames) == 2
    # First turn (crisis): no usage. Second turn (normal): real usage from fake_run_tutor.
    assert done_frames[0]["prompt_tokens"] is None
    assert done_frames[1]["prompt_tokens"] == 5
    assert done_frames[1]["completion_tokens"] == 3

    chunk_frames = [f for f in ws.sent if f["type"] == "chunk"]
    assert chunk_frames[0]["content"] == CRISIS_RESPONSE_TEXT
    assert chunk_frames[1]["content"] == "The answer is 4."

    persisted = await _persisted_messages(db_session, session_id)
    assert [m.role for m in persisted] == ["user", "assistant", "user", "assistant"]
    assert persisted[1].content == CRISIS_RESPONSE_TEXT
    assert persisted[2].content == "what's 2+2?"
    assert persisted[3].content == "The answer is 4."
    assert persisted[3].prompt_tokens == 5
    assert persisted[3].completion_tokens == 3


async def test_ordinary_message_never_triggers_the_crisis_path(
    crisis_session, keycloak_token, db_session, monkeypatch
):
    """Zero-behavior-change guarantee for the overwhelming majority of messages: an
    ordinary academic question goes straight to run_tutor, never the fixed text."""
    session_id = crisis_session

    tutor_calls: list[str] = []

    async def fake_run_tutor(session_id_arg, user_message, **kwargs):
        tutor_calls.append(user_message)
        yield TextChunk("Apoptosis is programmed cell death.")
        yield UsageInfo(prompt_tokens=2, completion_tokens=2)

    monkeypatch.setattr(chat_module, "run_tutor", fake_run_tutor)

    ws = FakeWebSocket(
        [{"type": "user_message", "content": "Explain apoptosis (programmed cell death) in this biology unit"}]
    )

    await chat_module.chat_ws(ws, session_id, keycloak_token)

    assert tutor_calls == ["Explain apoptosis (programmed cell death) in this biology unit"]
    chunk_frames = [f for f in ws.sent if f["type"] == "chunk"]
    assert chunk_frames[0]["content"] == "Apoptosis is programmed cell death."
    assert all(f["content"] != CRISIS_RESPONSE_TEXT for f in chunk_frames)
