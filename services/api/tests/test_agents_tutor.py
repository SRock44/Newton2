import uuid

from app.agents import tutor
from app.agents.tutor import TextChunk, ToolActivity
from app.providers.base import ToolCall
from tests.fakes import ScriptedToolCallingProvider


def text_of(events) -> str:
    return "".join(e.text for e in events if isinstance(e, TextChunk))


async def test_run_tutor_streams_directly_when_no_tool_needed(monkeypatch):
    fake = ScriptedToolCallingProvider([["Hello", " there."]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]

    assert text_of(events) == "Hello there."
    assert not any(isinstance(e, ToolActivity) for e in events)
    assert len(fake.calls_seen) == 1
    # the tutor should always offer its tool belt, even when the model doesn't use it
    assert {t.name for t in fake.calls_seen[0]["tools"]} >= {"calculator", "unit_converter"}


async def test_run_tutor_executes_a_tool_call_then_answers(monkeypatch):
    fake = ScriptedToolCallingProvider(
        [
            [ToolCall(id="call_1", name="calculator", arguments={"expression": "6*7"})],
            ["The answer is ", "42."],
        ]
    )
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "what is 6 times 7?")]

    assert text_of(events) == "The answer is 42."
    assert len(fake.calls_seen) == 2

    # The UI-visible signal that a tool actually ran: a started event immediately
    # followed (once the tool finishes) by a finished event, both for "calculator",
    # both before any of the final answer's text.
    activity = [e for e in events if isinstance(e, ToolActivity)]
    assert [(a.tool, a.phase) for a in activity] == [("calculator", "started"), ("calculator", "finished")]
    assert activity[0].label  # a real student-facing label, not blank
    first_text_index = next(i for i, e in enumerate(events) if isinstance(e, TextChunk))
    last_activity_index = max(i for i, e in enumerate(events) if isinstance(e, ToolActivity))
    assert last_activity_index < first_text_index

    # round 2 must include the assistant's tool-call turn and the tool's real result
    second_round = fake.calls_seen[1]["messages"]
    assistant_call_turn = next(m for m in second_round if m.role == "assistant" and m.tool_calls)
    assert assistant_call_turn.tool_calls[0].name == "calculator"

    tool_result_turns = [m for m in second_round if m.role == "tool"]
    assert len(tool_result_turns) == 1
    assert tool_result_turns[0].tool_call_id == "call_1"
    assert tool_result_turns[0].content == "42"  # the calculator tool actually ran


async def test_run_tutor_handles_a_tool_error_gracefully(monkeypatch):
    fake = ScriptedToolCallingProvider(
        [
            [ToolCall(id="call_1", name="calculator", arguments={"expression": "not math"})],
            ["Couldn't compute that."],
        ]
    )
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "bad expr")]

    assert text_of(events) == "Couldn't compute that."
    tool_result_turns = [m for m in fake.calls_seen[1]["messages"] if m.role == "tool"]
    assert tool_result_turns[0].content.startswith("Error:")


async def test_run_tutor_handles_an_unknown_tool_name_gracefully(monkeypatch):
    fake = ScriptedToolCallingProvider(
        [
            [ToolCall(id="call_1", name="does_not_exist", arguments={})],
            ["ok"],
        ]
    )
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]

    assert text_of(events) == "ok"
    tool_result_turns = [m for m in fake.calls_seen[1]["messages"] if m.role == "tool"]
    assert "unknown tool" in tool_result_turns[0].content
    # even an unknown tool still gets a start/finish pair — the UI shouldn't hang
    # waiting for a "finished" that never arrives just because the tool name was bad
    activity = [e for e in events if isinstance(e, ToolActivity)]
    assert [(a.tool, a.phase) for a in activity] == [("does_not_exist", "started"), ("does_not_exist", "finished")]


async def test_run_tutor_stops_after_max_rounds_with_a_clear_message(monkeypatch):
    fake = ScriptedToolCallingProvider(
        [
            [ToolCall(id=f"call_{i}", name="calculator", arguments={"expression": "1+1"})]
            for i in range(tutor.MAX_TOOL_ROUNDS)
        ]
    )
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "loop forever")]

    full = text_of(events)
    assert "round limit" in full
    assert len(fake.calls_seen) == tutor.MAX_TOOL_ROUNDS
