from collections.abc import AsyncIterator

from anthropic import AsyncAnthropic

from app.providers.base import ChatProvider, ChatTurn


class AnthropicProvider(ChatProvider):
    """BYOK: the user supplies their own Anthropic API key; we never pay for these calls."""

    def __init__(self, api_key: str):
        self.client = AsyncAnthropic(api_key=api_key)

    async def stream_chat(self, messages: list[ChatTurn], model: str) -> AsyncIterator[str]:
        system = "\n".join(m.content for m in messages if m.role == "system") or None
        turns = [{"role": m.role, "content": m.content} for m in messages if m.role != "system"]

        async with self.client.messages.stream(
            model=model,
            max_tokens=4096,
            system=system,
            messages=turns,
        ) as stream:
            async for text in stream.text_stream:
                yield text
