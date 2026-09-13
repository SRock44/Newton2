"""Confirms every tool an agent might call is actually registered and reachable,
end to end, against the real deployed sandbox-runner/searxng — not a mock. This is
deliberately separate from each tool's own unit tests: those prove the tool's own
logic; this proves the registry wiring + the live network topology together actually
let the Tutor's loop use them for real."""

import uuid

from app.agents import tutor
from app.agents.tutor import TextChunk
from app.providers.base import ToolCall
from app.tools.registry import get_tool_specs, run_tool
from tests.fakes import ScriptedToolCallingProvider


def test_all_expected_tools_are_registered():
    names = {t.name for t in get_tool_specs()}
    assert names == {
        "calculator",
        "unit_converter",
        "symbolic_math",
        "plot_function",
        "code_interpreter",
        "web_search",
        "textbook_lookup",
        "read_image",
        "start_study_session",
        "grammar_check",
        "format_citation",
        "generate_flashcards",
        "generate_practice_exam",
        "generate_study_plan",
        "sync_google_classroom",
    }


async def test_run_tool_code_interpreter_hits_the_real_sandbox_runner():
    result = await run_tool("code_interpreter", {"code": "print(6 * 7)"})
    assert "42" in result
    assert "Exit code: 0" in result


async def test_run_tool_web_search_hits_the_real_searxng():
    result = await run_tool("web_search", {"query": "python programming language"})
    assert not result.startswith("Search failed")
    assert "Search results for" in result


async def test_tutor_loop_can_actually_call_code_interpreter_end_to_end(monkeypatch):
    """The scripted provider stands in for the model's *decision* to call a tool (that
    part is unit-tested against a fake elsewhere, since there's no live model key to
    exercise real tool-call streaming) — but the tool *execution* here is completely
    real: it goes through the actual registry to the actual sandbox-runner container."""
    fake = ScriptedToolCallingProvider(
        [
            [ToolCall(id="call_1", name="code_interpreter", arguments={"code": "print(sum(range(100)))"})],
            ["The sum is 4950."],
        ]
    )
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "sum 0 to 99 with code")]

    assert "".join(e.text for e in events if isinstance(e, TextChunk)) == "The sum is 4950."
    tool_result_turns = [m for m in fake.calls_seen[1]["messages"] if m.role == "tool"]
    assert "4950" in tool_result_turns[0].content
