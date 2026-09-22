"""Confirms every tool an agent might call is actually registered and reachable,
end to end, against the real deployed sandbox-runner/searxng — not a mock. This is
deliberately separate from each tool's own unit tests: those prove the tool's own
logic; this proves the registry wiring + the live network topology together actually
let the Tutor's loop use them for real."""

import uuid

import pytest

from app.agents import tutor
from app.agents.tutor import TextChunk
from app.providers.base import ToolCall
from app.tools import registry
from app.tools.registry import (
    CORE_TOOL_NAMES,
    ON_DEMAND_TOOL_NAMES,
    USE_CAPABILITY_TOOL_NAME,
    get_core_tool_specs,
    get_tool_specs,
    get_use_capability_spec,
    run_tool,
)
from tests.fakes import ScriptedToolCallingProvider


def test_all_expected_tools_are_registered():
    names = {t.name for t in get_tool_specs()}
    assert names == {
        "calculator",
        "unit_converter",
        "symbolic_math",
        "chemistry_solver",
        "numeric_methods",
        "plot_function",
        "code_interpreter",
        "web_search",
        "research_fetch",
        "textbook_lookup",
        "read_image",
        "start_study_session",
        "grammar_check",
        "format_citation",
        "generate_flashcards",
        "generate_practice_exam",
        "generate_study_plan",
        "sync_google_classroom",
        "check_student_work",
        "check_code_work",
        "check_proof_work",
        "get_weak_areas",
        "get_math_hint",
        "write_research_paper",
        "deep_research",
        "create_artifact",
        "synthesize_sources",
    }


# ---------------------------------------------------------------------------
# The core/on-demand/read_image split behind use_capability (ROADMAP.md's per-turn
# tool-belt-trim entry) -- proves the three groups partition the real registry exactly,
# with no tool silently missing from every group (unreachable) or double-counted.
# ---------------------------------------------------------------------------


def test_core_on_demand_and_read_image_exactly_partition_every_registered_tool():
    all_names = {t.name for t in get_tool_specs()}
    on_demand = set(ON_DEMAND_TOOL_NAMES)
    core = set(CORE_TOOL_NAMES)

    assert core | on_demand | {"read_image"} == all_names
    assert core.isdisjoint(on_demand)
    assert "read_image" not in on_demand
    assert "read_image" not in core
    # use_capability itself is a meta-tool, never a real registered domain tool.
    assert USE_CAPABILITY_TOOL_NAME not in all_names


def test_get_core_tool_specs_returns_exactly_the_core_four():
    assert {t.name for t in get_core_tool_specs()} == set(CORE_TOOL_NAMES)


def test_use_capability_spec_names_every_on_demand_tool_and_only_those():
    spec = get_use_capability_spec()
    assert spec.name == USE_CAPABILITY_TOOL_NAME
    enum_names = set(spec.parameters["properties"]["names"]["items"]["enum"])
    assert enum_names == set(ON_DEMAND_TOOL_NAMES)
    # Every on-demand tool is at least named somewhere in the description a student's
    # model actually reads (not just the enum) -- proves the description text and the
    # enum weren't allowed to drift apart.
    for name in ON_DEMAND_TOOL_NAMES:
        assert name in spec.description


def test_get_tool_spec_returns_none_for_an_unregistered_name():
    assert registry.get_tool_spec("not_a_real_tool") is None
    assert registry.get_tool_spec("calculator") is not None


@pytest.mark.live_smoke
async def test_run_tool_code_interpreter_hits_the_real_sandbox_runner():
    result = await run_tool("code_interpreter", {"code": "print(6 * 7)"})
    assert "42" in result
    assert "Exit code: 0" in result


@pytest.mark.live_smoke
async def test_run_tool_web_search_hits_the_real_searxng():
    result = await run_tool("web_search", {"query": "python programming language"})
    assert not result.startswith("Search failed")
    assert "Search results for" in result


@pytest.mark.live_smoke
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
