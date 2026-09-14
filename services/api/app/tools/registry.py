import inspect

from app.providers.base import ToolSpec
from app.tools.base import Tool
from app.tools.calculator import CalculatorTool
from app.tools.check_work import CheckStudentWorkTool
from app.tools.citation import CitationFormatterTool
from app.tools.classroom_sync import ClassroomSyncTool
from app.tools.code_interpreter import CodeInterpreterTool
from app.tools.flashcard_generation import FlashcardGenerationTool
from app.tools.get_weak_areas import GetWeakAreasTool
from app.tools.grammar_check import GrammarCheckTool
from app.tools.math_hint import GetMathHintTool
from app.tools.practice_exam_generation import PracticeExamGenerationTool
from app.tools.research_fetch import ResearchFetchTool
from app.tools.study_plan_generation import StudyPlanGenerationTool
from app.tools.study_session import StudySessionTool
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
        ResearchFetchTool(),
        TextbookLookupTool(),
        VisionTool(),
        StudySessionTool(),
        GrammarCheckTool(),
        CitationFormatterTool(),
        FlashcardGenerationTool(),
        PracticeExamGenerationTool(),
        StudyPlanGenerationTool(),
        ClassroomSyncTool(),
        CheckStudentWorkTool(),
        GetWeakAreasTool(),
        GetMathHintTool(),
    ]
}

# Caller-supplied context a tool's own `run` signature can opt into by declaring a
# parameter of the same name -- never something the model controls via its own
# arguments. Add a new context value here (and thread it through run_tutor) if a future
# tool needs something else about the calling context.
_CONTEXT_PARAMS = ("session_id", "user_id")


def get_tool_specs() -> list[ToolSpec]:
    return [ToolSpec(name=t.name, description=t.description, parameters=t.parameters) for t in _TOOLS.values()]


async def run_tool(
    name: str,
    arguments: dict,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
) -> str:
    tool = _TOOLS.get(name)
    if tool is None:
        return f"Error: unknown tool '{name}'"
    try:
        call_args = dict(arguments)
        context = {"session_id": session_id, "user_id": user_id}
        accepted = inspect.signature(tool.run).parameters
        for param in _CONTEXT_PARAMS:
            if param in accepted:
                call_args[param] = context[param]
        return await tool.run(**call_args)
    except TypeError as exc:
        return f"Error: bad arguments for '{name}': {exc}"
    except Exception as exc:
        return f"Error running '{name}': {exc}"
