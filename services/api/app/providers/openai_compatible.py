import json
from collections.abc import AsyncIterator

import httpx

from app.providers.base import ChatProvider, ChatTurn, StreamEvent, TextDelta, ToolCallRequest, ToolSpec
from app.providers.tool_call_accumulator import ToolCallAccumulator


def _to_wire_message(turn: ChatTurn) -> dict:
    message: dict = {"role": turn.role, "content": turn.content}
    if turn.role == "tool":
        message["tool_call_id"] = turn.tool_call_id
        if turn.name:
            message["name"] = turn.name
    if turn.role == "assistant" and turn.tool_calls:
        message["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
            }
            for call in turn.tool_calls
        ]
    return message


def _to_wire_tools(tools: list[ToolSpec]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
        }
        for t in tools
    ]


class OpenAICompatibleProvider(ChatProvider):
    """Groq and OpenRouter both speak the OpenAI chat-completions wire format, including
    its tool-calling shape."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        extra_headers: dict[str, str] | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.extra_headers = extra_headers or {}
        self._transport = transport
        # Populated after stream_chat completes, if the wire response included a usage
        # chunk (requested below via stream_options) -- {"prompt_tokens": int,
        # "completion_tokens": int, ...}. None if the upstream never sent one. Read by
        # callers that need real token counts for cost tracking (see
        # app/services/billing.py's record_frontier_usage) -- an instance attribute
        # rather than a return value since stream_chat's signature is a shared interface
        # (ChatProvider) other providers implement too.
        self.last_usage: dict | None = None

    async def stream_chat(
        self, messages: list[ChatTurn], model: str, tools: list[ToolSpec] | None = None
    ) -> AsyncIterator[StreamEvent]:
        self.last_usage = None
        payload: dict = {
            "model": model,
            "messages": [_to_wire_message(m) for m in messages],
            "stream": True,
            # Both Groq and OpenRouter support this OpenAI-compatible extension: it adds
            # one extra SSE chunk at the end carrying token usage, which this class has
            # no other way to learn (a streamed response has no trailing non-streamed
            # usage field to read instead).
            "stream_options": {"include_usage": True},
        }
        if tools:
            payload["tools"] = _to_wire_tools(tools)

        headers = {"Authorization": f"Bearer {self.api_key}", **self.extra_headers}
        accumulator = ToolCallAccumulator()

        async with httpx.AsyncClient(timeout=60.0, transport=self._transport) as client:
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

                    if chunk.get("usage"):
                        self.last_usage = chunk["usage"]

                    choices = chunk.get("choices") or []
                    if not choices:
                        continue  # the final usage-only chunk has no choices to read
                    delta = choices[0]["delta"]

                    if delta.get("tool_calls"):
                        accumulator.add_delta(delta["tool_calls"])
                        continue

                    if delta.get("content"):
                        yield TextDelta(delta["content"])

        if not accumulator.is_empty():
            yield ToolCallRequest(accumulator.finalize())
