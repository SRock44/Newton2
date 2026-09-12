from app.providers.base import ToolSpec
from app.tools.base import Tool
from app.tools.calculator import CalculatorTool
from app.tools.unit_converter import UnitConverterTool

# Add a new tool by instantiating it here — nothing else in this file should need to
# change. Kept as an explicit list (not directory auto-discovery) so it's obvious at a
# glance what's live, and so adding a tool never requires editing agent/tutor code.
_TOOLS: dict[str, Tool] = {t.name: t for t in [CalculatorTool(), UnitConverterTool()]}


def get_tool_specs() -> list[ToolSpec]:
    return [ToolSpec(name=t.name, description=t.description, parameters=t.parameters) for t in _TOOLS.values()]


async def run_tool(name: str, arguments: dict) -> str:
    tool = _TOOLS.get(name)
    if tool is None:
        return f"Error: unknown tool '{name}'"
    try:
        return await tool.run(**arguments)
    except TypeError as exc:
        return f"Error: bad arguments for '{name}': {exc}"
    except Exception as exc:
        return f"Error running '{name}': {exc}"
