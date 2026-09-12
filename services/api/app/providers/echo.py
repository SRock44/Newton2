import asyncio
from collections.abc import AsyncIterator

from app.providers.base import ChatProvider, ChatTurn


class EchoProvider(ChatProvider):
    """Keyless fallback so the whole chat/memory pipeline runs and is testable without
    any provider API key configured. Real deployments set GROQ_API_KEY/OPENROUTER_API_KEY
    (or a BYOK Anthropic key) to replace this — see infra/README.md.
    """

    async def stream_chat(self, messages: list[ChatTurn], model: str) -> AsyncIterator[str]:
        last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
        reply = (
            f"[echo/no-provider-configured] you said: {last_user}"
            if last_user
            else "[echo/no-provider-configured] (empty message)"
        )
        for word in reply.split(" "):
            yield word + " "
            await asyncio.sleep(0.03)
