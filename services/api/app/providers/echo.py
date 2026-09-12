import asyncio
from collections.abc import AsyncIterator

from app.providers.base import ChatProvider, ChatTurn, StreamEvent, TextDelta, ToolSpec


class EchoProvider(ChatProvider):
    """Keyless fallback so the whole chat/memory/tool pipeline runs and is testable
    without any provider API key configured. Real deployments set GROQ_API_KEY/
    OPENROUTER_API_KEY (or a BYOK Anthropic key) to replace this — see infra/README.md.

    Never calls tools (there's no real model behind it to decide to) — it only ever
    yields TextDelta chunks, even when `tools` is passed.
    """

    async def stream_chat(
        self, messages: list[ChatTurn], model: str, tools: list[ToolSpec] | None = None
    ) -> AsyncIterator[StreamEvent]:
        last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
        reply = (
            f"[echo/no-provider-configured] you said: {last_user}"
            if last_user
            else "[echo/no-provider-configured] (empty message)"
        )
        for word in reply.split(" "):
            yield TextDelta(word + " ")
            await asyncio.sleep(0.03)
