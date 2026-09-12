import json
from collections.abc import AsyncIterator

from anthropic import AsyncAnthropic

from app.providers.base import ChatProvider, ChatTurn, StreamEvent, TextDelta, ToolCall, ToolCallRequest, ToolSpec


def _to_wire_messages(messages: list[ChatTurn]) -> tuple[str | None, list[dict]]:
    """Anthropic has no "tool" role: a tool result is a `tool_result` content block
    inside a *user* message, and all results answering one assistant tool-use turn must
    be batched into a single following user message — so consecutive ChatTurn(role="tool")
    entries get merged here rather than sent as separate messages."""
    system_parts = [m.content for m in messages if m.role == "system"]
    system = "\n".join(system_parts) or None

    wire: list[dict] = []
    pending_tool_results: list[dict] = []

    def flush_tool_results() -> None:
        if pending_tool_results:
            wire.append({"role": "user", "content": pending_tool_results.copy()})
            pending_tool_results.clear()

    for turn in messages:
        if turn.role == "system":
            continue
        if turn.role == "tool":
            pending_tool_results.append(
                {"type": "tool_result", "tool_use_id": turn.tool_call_id, "content": turn.content}
            )
            continue

        flush_tool_results()

        if turn.role == "assistant" and turn.tool_calls:
            content = [
                {"type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments} for c in turn.tool_calls
            ]
            wire.append({"role": "assistant", "content": content})
        else:
            wire.append({"role": turn.role, "content": turn.content})

    flush_tool_results()
    return system, wire


def _to_wire_tools(tools: list[ToolSpec]) -> list[dict]:
    return [{"name": t.name, "description": t.description, "input_schema": t.parameters} for t in tools]


class AnthropicProvider(ChatProvider):
    """BYOK: the user supplies their own Anthropic API key; we never pay for these calls."""

    def __init__(self, api_key: str):
        self.client = AsyncAnthropic(api_key=api_key)

    async def stream_chat(
        self, messages: list[ChatTurn], model: str, tools: list[ToolSpec] | None = None
    ) -> AsyncIterator[StreamEvent]:
        system, wire_messages = _to_wire_messages(messages)
        kwargs: dict = {"model": model, "max_tokens": 4096, "system": system, "messages": wire_messages}
        if tools:
            kwargs["tools"] = _to_wire_tools(tools)

        pending_calls: dict[int, dict] = {}

        async with self.client.messages.stream(**kwargs) as stream:
            async for event in stream:
                if event.type == "content_block_start" and event.content_block.type == "tool_use":
                    pending_calls[event.index] = {
                        "id": event.content_block.id,
                        "name": event.content_block.name,
                        "json": "",
                    }
                elif event.type == "content_block_delta":
                    if event.delta.type == "text_delta":
                        yield TextDelta(event.delta.text)
                    elif event.delta.type == "input_json_delta" and event.index in pending_calls:
                        pending_calls[event.index]["json"] += event.delta.partial_json

        if pending_calls:
            calls = [
                ToolCall(id=c["id"], name=c["name"], arguments=json.loads(c["json"]) if c["json"] else {})
                for c in pending_calls.values()
            ]
            yield ToolCallRequest(calls)
