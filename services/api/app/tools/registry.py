import inspect
from typing import Awaitable, Callable

from app.providers.base import ToolSpec
from app.tools.base import Tool
from app.tools.calculator import CalculatorTool
from app.tools.check_code_work import CheckCodeWorkTool
from app.tools.check_proof_work import CheckProofWorkTool
from app.tools.check_work import CheckStudentWorkTool
from app.tools.chemistry import ChemistrySolverTool
from app.tools.citation import CitationFormatterTool
from app.tools.classroom_sync import ClassroomSyncTool
from app.tools.code_interpreter import CodeInterpreterTool
from app.tools.create_artifact import CreateArtifactTool
from app.tools.deep_research import DeepResearchTool
from app.tools.flashcard_generation import FlashcardGenerationTool
from app.tools.get_weak_areas import GetWeakAreasTool
from app.tools.grammar_check import GrammarCheckTool
from app.tools.math_hint import GetMathHintTool
from app.tools.practice_exam_generation import PracticeExamGenerationTool
from app.tools.research_fetch import ResearchFetchTool
from app.tools.study_plan_generation import StudyPlanGenerationTool
from app.tools.study_session import StudySessionTool
from app.tools.symbolic_math import SymbolicMathTool
from app.tools.synthesize_sources import SynthesizeSourcesTool
from app.tools.textbook_lookup import TextbookLookupTool
from app.tools.unit_converter import UnitConverterTool
from app.tools.vision import VisionTool
from app.tools.visualizer import VisualizerTool
from app.tools.web_search import WebSearchTool
from app.tools.write_research_paper import WriteResearchPaperTool

# Add a new tool by instantiating it here — nothing else in this file should need to
# change. Kept as an explicit list (not directory auto-discovery) so it's obvious at a
# glance what's live, and so adding a tool never requires editing agent/tutor code.
_TOOLS: dict[str, Tool] = {
    t.name: t
    for t in [
        CalculatorTool(),
        UnitConverterTool(),
        SymbolicMathTool(),
        ChemistrySolverTool(),
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
        CheckCodeWorkTool(),
        CheckProofWorkTool(),
        GetWeakAreasTool(),
        GetMathHintTool(),
        WriteResearchPaperTool(),
        CreateArtifactTool(),
        SynthesizeSourcesTool(),
        DeepResearchTool(),
    ]
}

# Caller-supplied context a tool's own `run` signature can opt into by declaring a
# parameter of the same name -- never something the model controls via its own
# arguments. Add a new context value here (and thread it through run_tutor) if a future
# tool needs something else about the calling context.
#
# on_progress: an optional `Callable[[str], Awaitable[None]]` a slow, multi-stage tool
# can call zero or more times during its own `run()` to report a real, honest status
# string (never a fake/heuristic one) while still in flight -- see create_artifact.py's
# use of it and app/agents/tutor.py's run_tutor, which is what actually turns a call into
# a live-updating chip instead of one static label for the tool's entire duration.
_CONTEXT_PARAMS = ("session_id", "user_id", "on_progress")

# Sent directly, in full, on EVERY turn (see app/agents/tutor.py's run_tutor) --
# everything a typical simple student request (arithmetic, a quick lookup, a unit
# conversion, "what's happening right now") needs, kept small on purpose since this is
# real per-turn token cost regardless of whether the model ends up calling any of them.
CORE_TOOL_NAMES = ("calculator", "unit_converter", "symbolic_math", "web_search")

# The one deliberate exception to "everything else is on-demand": read_image is never
# offered via use_capability at all (see get_use_capability_spec below) because whether
# it's relevant is a deterministic, cheap, application-level fact about *this* message
# (does it contain a real "[Attached image: <id>]" marker -- see app/routers/chat.py's
# upload endpoint and app/agents/tutor.py's _IMAGE_ATTACHMENT_RE), never something worth
# spending a model round-trip discovering.
_READ_IMAGE_TOOL_NAME = "read_image"

# Every other registered tool, grouped with a short reason -- this IS get_use_capability_
# spec's own description text below, so it's kept compact rather than restating each
# tool's full own description. Order here is just presentation order in that text.
_ON_DEMAND_GROUPS: tuple[tuple[tuple[str, ...], str], ...] = (
    (
        ("chemistry_solver",),
        "any real chemistry computation -- balancing an equation, stoichiometry, PV=nRT, pH",
    ),
    (("plot_function",), "graphing a function/equation, incl. slider-enabled variants"),
    (("code_interpreter",), "running or testing your OWN scratch code"),
    (
        ("check_code_work",),
        "running the STUDENT'S own code (one or more files) against real tests and "
        "reporting per-test pass/fail -- never writing or fixing their code",
    ),
    (("research_fetch",), "reading one specific URL/source in full"),
    (("textbook_lookup",), "looking up a textbook definition or passage"),
    (("start_study_session",), "a full plan+flashcards+exam study session in one shot"),
    (("grammar_check",), "proofreading grammar/style"),
    (("format_citation",), "an exact APA/MLA/Chicago citation"),
    (
        ("generate_flashcards", "generate_practice_exam", "generate_study_plan"),
        "building study materials from a document/topic",
    ),
    (("sync_google_classroom",), "pulling assignments/grades from Google Classroom"),
    (("check_student_work",), "checking the student's own typed/attempted answer"),
    (
        ("check_proof_work",),
        "checking the student's own written PROOF (induction/contradiction/"
        "contrapositive/cases/direct) for structural validity and common fallacies, "
        "verifying any real algebraic sub-steps for real",
    ),
    (("get_weak_areas",), "finding real weak areas/exam-readiness before studying or generating"),
    (("get_math_hint",), "a leveled hint without giving the answer away"),
    (("write_research_paper",), "writing a full cited paper after an approved plan"),
    (
        ("deep_research",),
        "a synthesized, cited report answering an open research question from several "
        "real web sources -- not a formatted paper for submission",
    ),
    (
        ("create_artifact",),
        "building a real interactive artifact (diagram/chart/slideshow/demo) after the "
        "student confirms -- slow and expensive, never speculatively",
    ),
    (
        ("synthesize_sources",),
        "comparing/synthesizing agreement, disagreement, or how arguments build on each "
        "other across two or more of the student's own uploaded readings",
    ),
)

ON_DEMAND_TOOL_NAMES: tuple[str, ...] = tuple(name for names, _reason in _ON_DEMAND_GROUPS for name in names)

USE_CAPABILITY_TOOL_NAME = "use_capability"


def get_tool_specs() -> list[ToolSpec]:
    """Every registered tool, regardless of whether it's core, on-demand, or the
    deterministic read_image exception -- used where the FULL real tool belt matters
    (the /tools listing endpoint, the registry-integration test proving every tool is
    actually reachable). Never what a live run_tutor() call sends the model per turn --
    see get_core_tool_specs/get_use_capability_spec/get_tool_spec for that."""
    return [ToolSpec(name=t.name, description=t.description, parameters=t.parameters) for t in _TOOLS.values()]


def get_core_tool_specs() -> list[ToolSpec]:
    """The always-sent subset (see CORE_TOOL_NAMES) -- what run_tutor() starts every
    fresh turn with, before use_capability or an attached image ever grows the list."""
    return [
        ToolSpec(name=t.name, description=t.description, parameters=t.parameters)
        for name, t in _TOOLS.items()
        if name in CORE_TOOL_NAMES
    ]


def get_tool_spec(name: str) -> ToolSpec | None:
    """One tool's real spec by name, or None if it isn't registered -- how run_tutor()
    grows its per-turn tools list, both for the deterministic read_image case and for
    whatever use_capability just loaded."""
    t = _TOOLS.get(name)
    if t is None:
        return None
    return ToolSpec(name=t.name, description=t.description, parameters=t.parameters)


def get_use_capability_spec() -> ToolSpec:
    """The one meta-tool sent alongside the core four on every turn. Naming it here
    (never a real domain tool, never routed through run_tool/_TOOLS) keeps it clearly
    distinct: calling it does no real work, it only tells run_tutor's own loop which
    real tool schema(s) to add for the model's NEXT round."""
    options = "; ".join(f"{'/'.join(names)} -- {reason}" for names, reason in _ON_DEMAND_GROUPS)
    description = (
        "Loads one or more less-common tools so you can call them for real on your "
        "NEXT turn -- this itself never does real work. Name every tool you'll need in "
        "ONE call when you can tell upfront (don't spend a separate call per tool). "
        f"Options: {options}."
    )
    return ToolSpec(
        name=USE_CAPABILITY_TOOL_NAME,
        description=description,
        parameters={
            "type": "object",
            "properties": {
                "names": {
                    "type": "array",
                    "items": {"type": "string", "enum": list(ON_DEMAND_TOOL_NAMES)},
                    "minItems": 1,
                    "description": "One or more tool names to load, from the Options listed above.",
                },
            },
            "required": ["names"],
        },
    )


async def run_tool(
    name: str,
    arguments: dict,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    on_progress: Callable[[str], Awaitable[None]] | None = None,
) -> str:
    tool = _TOOLS.get(name)
    if tool is None:
        return f"Error: unknown tool '{name}'"
    try:
        call_args = dict(arguments)
        context = {"session_id": session_id, "user_id": user_id, "on_progress": on_progress}
        accepted = inspect.signature(tool.run).parameters
        for param in _CONTEXT_PARAMS:
            if param in accepted:
                call_args[param] = context[param]
        return await tool.run(**call_args)
    except TypeError as exc:
        return f"Error: bad arguments for '{name}': {exc}"
    except Exception as exc:
        return f"Error running '{name}': {exc}"
