import inspect

from app.providers.base import ToolSpec
from app.tools.base import Tool
from app.tools.calculator import CalculatorTool
from app.tools.code_interpreter import CodeInterpreterTool
from app.tools.symbolic_math import SymbolicMathTool
from app.tools.textbook_lookup import TextbookLookupTool
from app.tools.unit_converter import UnitConverterTool
from app.tools.vision import VisionTool
from app.tools.visualizer import VisualizerTool
from app.tools.web_search import WebSearchTool

# Add a new tool by instantiating it here — nothing else in this file should need to
# change. Kept as an explicit list (not directory auto-discovery) so it's obvious at a
# glance what's live, and so adding a tool never requires editing agent/tutor code.
_TOOLS: dict[str, Tool] = {
    t.name: t
    for t in [
        CalculatorTool(),
        UnitConverterTool(),
        SymbolicMathTool(),
        VisualizerTool(),
        CodeInterpreterTool(),
        WebSearchTool(),
        TextbookLookupTool(),
        VisionTool(),
    ]
}


def get_tool_specs() -> list[ToolSpec]:
    return [ToolSpec(name=t.name, description=t.description, parameters=t.parameters) for t in _TOOLS.values()]


async def run_tool(name: str, arguments: dict, *, session_id: str | None = None) -> str:
    """`session_id` is caller-supplied context (which chat session this call happened
    in), never something the model controls — only passed through to a tool that
    actually declares a `session_id` parameter (right now just VisionTool, to scope
    which attached image it's allowed to read), so every other tool is unaffected."""
    tool = _TOOLS.get(name)
    if tool is None:
        return f"Error: unknown tool '{name}'"
    try:
        call_args = dict(arguments)
        if "session_id" in inspect.signature(tool.run).parameters:
            call_args["session_id"] = session_id
        return await tool.run(**call_args)
    except TypeError as exc:
        return f"Error: bad arguments for '{name}': {exc}"
    except Exception as exc:
        return f"Error running '{name}': {exc}"
