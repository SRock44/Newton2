from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal

from app.memory.working import get_bundle
from app.providers.base import ChatTurn, TextDelta, ToolCallRequest
from app.providers.registry import get_provider
from app.tools.registry import get_tool_specs, run_tool


@dataclass
class TextChunk:
    """A piece of the model's own text answer, streamed as it arrives."""

    text: str


@dataclass
class ToolActivity:
    """The Tutor started or finished executing a tool call — surfaced to the UI so
    "Newton is doing something" is visible, not silent."""

    tool: str
    label: str
    phase: Literal["started", "finished"]


TutorEvent = TextChunk | ToolActivity

# Short, student-facing descriptions of what each tool is doing — keyed by each tool's
# real registry `.name` (see app/tools/registry.py's _TOOLS). Deliberately not technical
# ("Doing the math", not "invoking calculator") since this renders directly in the UI.
_TOOL_LABELS: dict[str, str] = {
    "calculator": "Doing the math",
    "unit_converter": "Converting units",
    "symbolic_math": "Solving with symbolic math",
    "plot_function": "Building a visualization",
    "code_interpreter": "Running code",
    "web_search": "Searching the web",
    "textbook_lookup": "Looking up textbook material",
    "read_image": "Reading the image",
    "start_study_session": "Preparing your study session",
    "grammar_check": "Checking grammar",
    "format_citation": "Formatting the citation",
}


def _label_for(tool_name: str) -> str:
    return _TOOL_LABELS.get(tool_name, f"Using {tool_name}")

SYSTEM_PROMPT = (
    "You are Newton, an academic tutor. Be clear, encouraging, and concise. "
    "When relevant, use what you already know about the student below. "
    "You have tools available (calculator, unit converter) — use them for exact "
    "arithmetic or unit conversions instead of computing by hand.\n\n"
    "For a step-by-step math derivation (solving, differentiating, integrating, "
    "simplifying, factoring, or expanding an expression): first call the symbolic_math "
    "tool to get the exact, verified answer, then present your derivation as a fenced "
    '```math-steps block containing JSON in this exact shape: {"steps": ["first step, '
    'plain text or with inline $LaTeX$", "next step", "..."]}. Each array entry is one '
    "step, revealed to the student one at a time rather than all at once — keep each "
    "step to a single clear idea, and make the final step state the answer you actually "
    "got from symbolic_math, never a value you computed by hand instead."
)

# A confused/looping model shouldn't be able to hold the WS connection open forever
# calling tools back-to-back with no final answer.
MAX_TOOL_ROUNDS = 4


async def run_tutor(
    session_id: str,
    user_message: str,
    byok_anthropic_key: str | None = None,
    user_id: str | None = None,
) -> AsyncIterator[TutorEvent]:
    bundle = await get_bundle(session_id)

    turns = [ChatTurn(role="system", content=SYSTEM_PROMPT)]
    if bundle["profile_facts"]:
        facts_text = "\n".join(bundle["profile_facts"])
        turns.append(ChatTurn(role="system", content=f"What you know about this student:\n{facts_text}"))
    if bundle.get("retrieved_chunks"):
        chunks_text = "\n".join(bundle["retrieved_chunks"])
        turns.append(
            ChatTurn(
                role="system",
                content=f"Relevant material from the student's uploaded documents:\n{chunks_text}",
            )
        )
    for turn in bundle["turns"]:
        turns.append(ChatTurn(role=turn["role"], content=turn["content"]))
    turns.append(ChatTurn(role="user", content=user_message))

    provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
    tools = get_tool_specs()

    for _round in range(MAX_TOOL_ROUNDS):
        pending_calls = None
        async for event in provider.stream_chat(turns, model, tools=tools):
            if isinstance(event, TextDelta):
                yield TextChunk(event.text)
            elif isinstance(event, ToolCallRequest):
                pending_calls = event.calls
                break

        if pending_calls is None:
            return  # model gave a final text answer — done

        turns.append(ChatTurn(role="assistant", content="", tool_calls=pending_calls))
        for call in pending_calls:
            label = _label_for(call.name)
            yield ToolActivity(tool=call.name, label=label, phase="started")
            result = await run_tool(call.name, call.arguments, session_id=session_id, user_id=user_id)
            yield ToolActivity(tool=call.name, label=label, phase="finished")
            turns.append(ChatTurn(role="tool", content=result, tool_call_id=call.id, name=call.name))
        # loop again: the model sees the tool results and either answers or calls again

    yield TextChunk(
        "\n\n_(Newton hit the tool-use round limit without a final answer — try rephrasing.)_"
    )
