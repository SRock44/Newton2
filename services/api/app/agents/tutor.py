import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal

from app.core.config import get_settings
from app.db.base import SessionLocal
from app.db.models import User
from app.memory.working import get_bundle
from app.providers.base import ChatProvider, ChatTurn, TextDelta, ToolCallRequest
from app.providers.openai_compatible import OpenAICompatibleProvider
from app.providers.registry import get_provider
from app.services import billing as billing_service
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


@dataclass
class UsageInfo:
    """Total token usage across every provider call this run_tutor() invocation made
    (there may be several, one per tool-call round) — yielded once, as the last event,
    so the caller can persist it on the assistant's ChatMessage row for a running
    per-chat token total. Tracked for every call this provider type supports usage
    reporting for (both free-tier and Pro/frontier — see OpenAICompatibleProvider.
    last_usage), not just Pro ones; the separate Pro credit-ledger charge in this
    function's `finally` block is a different concern that happens to reuse the same
    numbers."""

    prompt_tokens: int
    completion_tokens: int


TutorEvent = TextChunk | ToolActivity | UsageInfo

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
    "generate_flashcards": "Building your flashcards",
    "generate_practice_exam": "Building a practice exam",
    "generate_study_plan": "Building your study plan",
}


def _label_for(tool_name: str) -> str:
    return _TOOL_LABELS.get(tool_name, f"Using {tool_name}")


async def _load_user(user_id: str | None) -> User | None:
    if not user_id:
        return None
    async with SessionLocal() as db:
        return await db.get(User, uuid.UUID(user_id))


def _select_provider(user: User | None, byok_anthropic_key: str | None) -> tuple[ChatProvider, str, bool]:
    """Decide which provider+model answers this turn, and whether that's a Pro-tier
    frontier model (in which case the caller must track its token usage against the
    user's credit ledger). Routes to a frontier model only when ALL of: the user is Pro
    (billing_service.is_pro — the single shared plan check, see that module's docstring),
    they still have credit budget left this period (pro_credits_remaining), and
    OpenRouter is actually configured on this server (frontier routing always goes via
    OpenRouter, regardless of which provider the free tier happens to be using) — any one
    of those failing means "quietly use the normal free-tier get_provider() behavior",
    never an error, exactly like a free user would get.
    """
    settings = get_settings()
    if (
        user is not None
        and billing_service.is_pro(user)
        and billing_service.pro_credits_remaining(user)
        and settings.openrouter_api_key
    ):
        model = billing_service.resolve_pro_model(user)
        provider = OpenAICompatibleProvider(
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.openrouter_api_key.get_secret_value(),
        )
        return provider, model, True

    provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
    return provider, model, False

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

    user = await _load_user(user_id)
    provider, model, is_frontier = _select_provider(user, byok_anthropic_key)
    tools = get_tool_specs()

    # Tracks real token usage across every round of this call (which may span several
    # tool-call rounds, each its own provider call) — yielded once as UsageInfo for the
    # caller to persist a per-chat running total, and, only when is_frontier, also
    # charged against the user's Pro credit ledger exactly once in the finally block
    # below rather than per round.
    prompt_tokens_total = 0
    completion_tokens_total = 0

    try:
        for _round in range(MAX_TOOL_ROUNDS):
            pending_calls = None
            async for event in provider.stream_chat(turns, model, tools=tools):
                if isinstance(event, TextDelta):
                    yield TextChunk(event.text)
                elif isinstance(event, ToolCallRequest):
                    pending_calls = event.calls
                    break

            if isinstance(provider, OpenAICompatibleProvider) and provider.last_usage:
                prompt_tokens_total += provider.last_usage.get("prompt_tokens", 0)
                completion_tokens_total += provider.last_usage.get("completion_tokens", 0)

            if pending_calls is None:
                yield UsageInfo(prompt_tokens_total, completion_tokens_total)
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
        yield UsageInfo(prompt_tokens_total, completion_tokens_total)
    finally:
        # Runs whether this call ended in a final answer, the round-limit message, or
        # (via the generator's own close/GC) the caller giving up early -- a Pro user's
        # frontier-model spend still gets tracked for whatever tokens were actually
        # used. No-op for a free-tier call (prompt/completion totals stay 0).
        if is_frontier and (prompt_tokens_total or completion_tokens_total):
            await billing_service.record_frontier_usage(
                user.id, model, prompt_tokens_total, completion_tokens_total
            )
