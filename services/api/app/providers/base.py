from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass
class ChatTurn:
    role: str  # "user" | "assistant" | "system"
    content: str


class ChatProvider(ABC):
    """One interface over every backend model source (Groq, OpenRouter, BYOK Anthropic).

    Agents call `stream_chat` and never know which provider answered — swapping the
    backend behind a given agent is a config change, not a code change.
    """

    @abstractmethod
    def stream_chat(self, messages: list[ChatTurn], model: str) -> AsyncIterator[str]:
        """Yield response text chunks as they arrive."""
        ...
