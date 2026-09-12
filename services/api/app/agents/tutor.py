from collections.abc import AsyncIterator

from app.memory.working import get_bundle
from app.providers.base import ChatTurn
from app.providers.registry import get_provider

SYSTEM_PROMPT = (
    "You are Newton, an academic tutor. Be clear, encouraging, and concise. "
    "When relevant, use what you already know about the student below."
)


async def run_tutor(
    session_id: str, user_message: str, byok_anthropic_key: str | None = None
) -> AsyncIterator[str]:
    bundle = await get_bundle(session_id)

    turns = [ChatTurn(role="system", content=SYSTEM_PROMPT)]
    if bundle["profile_facts"]:
        facts_text = "\n".join(bundle["profile_facts"])
        turns.append(ChatTurn(role="system", content=f"What you know about this student:\n{facts_text}"))
    for turn in bundle["turns"]:
        turns.append(ChatTurn(role=turn["role"], content=turn["content"]))
    turns.append(ChatTurn(role="user", content=user_message))

    provider, model = get_provider(byok_anthropic_key=byok_anthropic_key)
    async for chunk in provider.stream_chat(turns, model):
        yield chunk
