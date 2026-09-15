from collections.abc import AsyncIterator

from app.providers.base import ChatProvider, ChatTurn, StreamEvent, TextDelta, ToolCall, ToolCallRequest, ToolSpec


class ScriptedToolCallingProvider(ChatProvider):
    """A fully-scripted provider double for testing the Tutor's tool-calling loop
    without any real model. Pass a list of "rounds"; each round is either a list of
    strings (streamed as TextDelta chunks — a final answer) or a list of ToolCall
    (yielded as one ToolCallRequest — the model "decided" to call tools). Records every
    call's messages/tools so tests can assert what the loop actually sent each round."""

    def __init__(self, script: list[list[str] | list[ToolCall]]):
        self._script = list(script)
        self.calls_seen: list[dict] = []

    async def stream_chat(
        self, messages: list[ChatTurn], model: str, tools: list[ToolSpec] | None = None
    ) -> AsyncIterator[StreamEvent]:
        # Snapshot `tools` (a copy, not the live reference) at the moment of this call --
        # app/agents/tutor.py's run_tutor mutates its own `tools` list IN PLACE across
        # rounds as use_capability loads more of the belt, so recording the bare
        # reference here would make every earlier round's recorded snapshot silently
        # "see" tools loaded in later rounds too, which never actually happened on the
        # wire for that earlier, already-sent request.
        self.calls_seen.append(
            {"messages": list(messages), "model": model, "tools": list(tools) if tools is not None else None}
        )
        step = self._script.pop(0)
        if step and isinstance(step[0], ToolCall):
            yield ToolCallRequest(list(step))  # type: ignore[arg-type]
        else:
            for text in step:
                yield TextDelta(text)  # type: ignore[arg-type]
