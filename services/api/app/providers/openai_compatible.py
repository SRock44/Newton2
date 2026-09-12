import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import ChatProvider, ChatTurn


class OpenAICompatibleProvider(ChatProvider):
    """Groq and OpenRouter both speak the OpenAI chat-completions wire format."""

    def __init__(self, base_url: str, api_key: str, extra_headers: dict[str, str] | None = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.extra_headers = extra_headers or {}

    async def stream_chat(self, messages: list[ChatTurn], model: str) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {self.api_key}", **self.extra_headers}

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", f"{self.base_url}/chat/completions", json=payload, headers=headers
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"].get("content")
                    if delta:
                        yield delta
