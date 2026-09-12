from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema object describing the tool's input


@dataclass
class ChatTurn:
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    tool_call_id: str | None = None  # role="tool": which call this turn answers
    name: str | None = None  # role="tool": the tool's name (some providers require it)
    tool_calls: list[ToolCall] | None = None  # role="assistant": calls this turn made


@dataclass
class TextDelta:
    text: str


@dataclass
class ToolCallRequest:
    calls: list[ToolCall]


StreamEvent = TextDelta | ToolCallRequest


class ChatProvider(ABC):
    """One interface over every backend model source (Groq, OpenRouter, BYOK Anthropic).

    Agents call `stream_chat` and never know which provider answered — swapping the
    backend behind a given agent is a config change, not a code change.
    """

    @abstractmethod
    def stream_chat(
        self,
        messages: list[ChatTurn],
        model: str,
        tools: list[ToolSpec] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Yield `TextDelta`s as they arrive. If `tools` is given and the model decides
        to call one or more, yield exactly one `ToolCallRequest` instead and stop —
        callers should treat it as terminal for that turn (act on it, then start a new
        turn with the tool results appended) rather than expecting more deltas after it.
        """
        ...
