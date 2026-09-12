from abc import ABC, abstractmethod
from typing import Any


class Tool(ABC):
    """A deterministic or sandboxed function an agent can call. `name`/`description`/
    `parameters` are exposed to the model as a ToolSpec (see providers/registry.py);
    `run` executes it. Tools should never raise past `run` in a way the caller can't
    turn into a string result — the registry wraps calls, but a tool that produces a
    clear "Error: ..." string itself gives the model something useful to react to."""

    name: str
    description: str
    parameters: dict[str, Any]

    @abstractmethod
    async def run(self, **kwargs: Any) -> str: ...
