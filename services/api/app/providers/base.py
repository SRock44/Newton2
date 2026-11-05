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
class ReasoningDelta:
    """A piece of the model's own internal "thinking"/reasoning trace, as it streams —
    OpenRouter's `delta.reasoning` field on a reasoning-capable model (confirmed live:
    Meta's Muse Spark Contributor streams ~3-7s of this before any `delta.content`
    starts). Distinct from TextDelta: this is never the model's actual answer, just its
    scratch-work commentary, so callers must never append it into a persisted reply —
    see app/agents/tutor.py's ReasoningChunk for the one place this becomes a
    student-visible frame, and why it's deliberately gated the same way as TextDelta
    (suppress_text) rather than always shown: a reasoning model can "think through" the
    literal final answer before writing its reply, which would defeat Focus Mode's
    whole point if streamed live during a held-back answer.

    Real bug this exists to fix: before this type existed, OpenAICompatibleProvider
    only ever checked `delta.get("content")` — every reasoning token a model actually
    streamed was silently read off the wire and discarded, with nothing forwarded to
    the student, who saw total silence for however long the model's reasoning phase
    took (measured live: 7-14s) even though the provider had already started
    streaming real activity seconds earlier."""

    text: str


@dataclass
class ToolCallRequest:
    calls: list[ToolCall]


StreamEvent = TextDelta | ReasoningDelta | ToolCallRequest


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
