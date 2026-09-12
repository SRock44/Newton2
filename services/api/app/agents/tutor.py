from collections.abc import AsyncIterator

from app.memory.working import get_bundle
from app.providers.base import ChatTurn, TextDelta, ToolCallRequest
from app.providers.registry import get_provider
from app.tools.registry import get_tool_specs, run_tool

SYSTEM_PROMPT = (
    "You are Newton, an academic tutor. Be clear, encouraging, and concise. "
    "When relevant, use what you already know about the student below. "
    "You have tools available (calculator, unit converter) — use them for exact "
    "arithmetic or unit conversions instead of computing by hand."
)

# A confused/looping model shouldn't be able to hold the WS connection open forever
# calling tools back-to-back with no final answer.
MAX_TOOL_ROUNDS = 4


async def run_tutor(
    session_id: str, user_message: str, byok_anthropic_key: str | None = None
) -> AsyncIterator[str]:
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
                yield event.text
            elif isinstance(event, ToolCallRequest):
                pending_calls = event.calls
                break

        if pending_calls is None:
            return  # model gave a final text answer — done

        turns.append(ChatTurn(role="assistant", content="", tool_calls=pending_calls))
        for call in pending_calls:
            result = await run_tool(call.name, call.arguments)
            turns.append(ChatTurn(role="tool", content=result, tool_call_id=call.id, name=call.name))
        # loop again: the model sees the tool results and either answers or calls again

    yield "\n\n_(Newton hit the tool-use round limit without a final answer — try rephrasing.)_"
