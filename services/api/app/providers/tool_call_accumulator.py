import json
from dataclasses import dataclass, field

from app.providers.base import ToolCall


@dataclass
class _PendingCall:
    id: str = ""
    name: str = ""
    arguments_json: str = ""


@dataclass
class ToolCallAccumulator:
    """Accumulates OpenAI-compatible streaming `delta.tool_calls` fragments.

    Groq/OpenRouter (and OpenAI itself) stream a tool call across many chunks: the first
    chunk for a given `index` usually carries `id` and `function.name`, and every chunk
    (including that first one) carries a fragment of `function.arguments` that must be
    concatenated in order, not replaced. This is a pure, network-free class specifically
    so that fragment-accumulation logic can be unit-tested with synthetic delta dicts,
    since there's no real provider key in this project to test the live wire format
    against — see tests/test_tool_call_accumulator.py.
    """

    _by_index: dict[int, _PendingCall] = field(default_factory=dict)

    def add_delta(self, tool_call_deltas: list[dict]) -> None:
        for delta in tool_call_deltas:
            index = delta.get("index", 0)
            pending = self._by_index.setdefault(index, _PendingCall())
            if delta.get("id"):
                pending.id = delta["id"]
            function = delta.get("function") or {}
            if function.get("name"):
                pending.name = function["name"]
            if function.get("arguments"):
                pending.arguments_json += function["arguments"]

    def is_empty(self) -> bool:
        return not self._by_index

    def finalize(self) -> list[ToolCall]:
        """Parse each accumulated arguments string as JSON. Raises if a call never got
        a name, or its arguments never formed valid JSON — better to surface that loudly
        than silently hand an agent a broken tool call."""
        calls: list[ToolCall] = []
        for index in sorted(self._by_index):
            pending = self._by_index[index]
            if not pending.name:
                raise ValueError(f"tool call at index {index} never received a function name")
            try:
                arguments = json.loads(pending.arguments_json) if pending.arguments_json else {}
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"tool call '{pending.name}' arguments did not form valid JSON: "
                    f"{pending.arguments_json!r}"
                ) from exc
            calls.append(ToolCall(id=pending.id, name=pending.name, arguments=arguments))
        return calls
