import re
from typing import Any

import sympy

from app.tools.base import Tool
from app.tools.symbolic_math import _parse, solve_math

# Instruction/filler words stripped from the problem statement before it's tested for
# "does this look like math" and handed to solve_math -- a student's problem is usually
# phrased as a sentence ("Solve 2x + 4 = 0 for x."), not a bare expression.
_INSTRUCTION_WORDS = re.compile(
    r"\b(solve|simplify|differentiate|integrate|factor|expand|find|compute|evaluate|"
    r"derivative of|integral of|for the variable \w+|for \w+|with respect to \w+|"
    r"what is|please|the equation|the expression)\b",
    re.IGNORECASE,
)
_OPERATOR_CHARS = set("+-*/^=")
_MATH_FUNCS = ("sin", "cos", "tan", "log", "ln", "sqrt", "exp")


def _detect_operation(problem: str) -> str:
    lowered = problem.lower()
    if "differentiate" in lowered or "derivative" in lowered or "d/dx" in lowered:
        return "differentiate"
    if "integrate" in lowered or "integral" in lowered or "antiderivative" in lowered:
        return "integrate"
    if "factor" in lowered:
        return "factor"
    if "expand" in lowered:
        return "expand"
    if "simplify" in lowered:
        return "simplify"
    if "=" in problem:
        return "solve"
    return "simplify"


def _extract_expression(problem: str) -> str:
    cleaned = _INSTRUCTION_WORDS.sub(" ", problem)
    return cleaned.strip(" ?.\n\t")


def _looks_like_math(expression: str) -> bool:
    """A cheap gate run BEFORE calling solve_math: sympy's implicit-multiplication
    parser will happily "parse" an ordinary English sentence as a product of one-letter
    symbols (e.g. "the king was mean" -> t*h*e*k*i*n*g...), so a successful parse alone
    doesn't prove this is actually math. Require some real math-looking punctuation
    too."""
    if not expression:
        return False
    has_operator = any(ch in _OPERATOR_CHARS for ch in expression)
    has_digit = any(ch.isdigit() for ch in expression)
    has_func = any(fn in expression.lower() for fn in _MATH_FUNCS)
    return has_func or (has_operator and has_digit)


def _student_final_text(student_work: str) -> str:
    """The last non-empty line of the student's work, with any leading 'x = ' style
    label stripped -- a reasonable, simple stand-in for "their stated final answer"."""
    lines = [ln.strip() for ln in student_work.strip().splitlines() if ln.strip()]
    if not lines:
        return ""
    last = lines[-1]
    if "=" in last:
        last = last.rsplit("=", 1)[-1]
    return last.strip().rstrip(".").strip()


def _compare_final_answer(
    operation: str, true_answer: str, student_work: str
) -> tuple[bool | None, str]:
    """Objective, symbolic (never hallucinated) comparison of the student's stated
    final answer against the verified ground truth. Returns (None, extracted) when
    nothing parseable could be pulled out of the student's work, so the caller can fall
    back to asking the model to compare manually instead of asserting a verdict."""
    extracted = _student_final_text(student_work)
    if not extracted:
        return None, extracted

    try:
        student_val = _parse(extracted)
    except Exception:
        return None, extracted

    try:
        if operation == "solve":
            solutions = sympy.sympify(true_answer)
            if not isinstance(solutions, (list, tuple)):
                solutions = [solutions]
            match = any(sympy.simplify(student_val - sol) == 0 for sol in solutions)
        else:
            true_val = _parse(true_answer)
            match = sympy.simplify(true_val - student_val) == 0
    except Exception:
        return None, extracted

    return bool(match), extracted


def _math_verdict(problem: str, student_work: str) -> str | None:
    """Returns a grounded verification message when `problem` looks like solvable
    math, else None so the caller falls back to conceptual verification. Never raises:
    a parse/compute failure just means "not math we can verify", not an error."""
    expression = _extract_expression(problem)
    if not _looks_like_math(expression):
        return None

    operation = _detect_operation(problem)
    try:
        true_answer = solve_math(operation, expression)
    except Exception:
        return None

    correct, extracted = _compare_final_answer(operation, true_answer, student_work)

    if correct is None:
        return (
            f"Verified ground truth (via symbolic math, not guesswork): {operation} of "
            f"'{expression}' = {true_answer}.\n\n"
            "Couldn't automatically pick out a final answer from the student's work to "
            "compare against that, so check it yourself: does their work actually reach "
            f"{true_answer}? Walk through their steps below and point to the exact step "
            "where it first goes wrong, if any, rather than just re-deriving everything.\n\n"
            f"Student's work:\n{student_work}"
        )

    if correct:
        return (
            f"CORRECT. Verified via symbolic math: {operation} of '{expression}' = "
            f"{true_answer}, which matches the student's final answer ('{extracted}'). "
            "Give brief, encouraging confirmation -- no need to re-derive the whole "
            "solution for them."
        )

    return (
        f"INCORRECT. Verified via symbolic math: {operation} of '{expression}' = "
        f"{true_answer}, but the student's final answer ('{extracted}') does not match. "
        "Look at their shown work below and point to the exact step or claim where it "
        "first diverges from correct -- quote it, don't just hand back the right answer "
        "and let them diff it themselves.\n\n"
        f"Student's work:\n{student_work}"
    )


class CheckStudentWorkTool(Tool):
    """For a student's own TYPED answer/solution to a problem -- verifies it and
    pinpoints exactly where it's right or wrong, rather than re-solving from scratch
    and handing back a fresh answer for the student to compare against themselves
    (which defeats the pedagogical point). Distinct from read_image's "check my
    photographed/handwritten work" -- this is for text the student typed directly into
    chat. Math problems get an objective, symbolic-math-verified verdict; conceptual/
    written problems get a careful-verification prompt instead, since there's no
    computational ground truth to check those against."""

    name = "check_student_work"
    description = (
        "Checks a student's own TYPED answer or solution to a problem and reports "
        "specifically where it's right or wrong -- not a fresh re-solved answer for "
        "them to compare against themselves. For math, this is verified against real "
        "symbolic-math computation (never guessed). Call this whenever a student "
        "shares their own attempt at a problem and asks if it's right, wants it "
        "checked, or wants feedback on their work. (For a photo of handwritten work, "
        "use read_image instead.)"
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "problem": {
                "type": "string",
                "description": "The question or problem the student was solving.",
            },
            "student_work": {
                "type": "string",
                "description": "The student's own answer, solution, or work-shown steps, as text.",
            },
        },
        "required": ["problem", "student_work"],
    }

    async def run(self, problem: str, student_work: str) -> str:
        if not problem or not problem.strip():
            return "Error: problem must not be empty."
        if not student_work or not student_work.strip():
            return "Error: student_work must not be empty."

        try:
            math_result = _math_verdict(problem, student_work)
        except Exception as exc:
            return f"Error: couldn't check this work ({exc})."

        if math_result is not None:
            return math_result

        return (
            "This is a conceptual/written problem, not one with a computed ground "
            "truth to check against -- verify it with careful, honest reasoning "
            "instead of trusting either the problem's phrasing or the student's "
            "confidence.\n\n"
            f"Problem: {problem}\n\nStudent's work/answer:\n{student_work}\n\n"
            "Work through the problem yourself first, independently, before judging "
            "theirs. Then give a clear verdict -- Correct / Partially correct / "
            "Incorrect -- and identify the SPECIFIC claim or step that is incorrect or "
            "incomplete, quoting it directly. Don't just restate a fresh 'correct' "
            "answer and diff it superficially against theirs."
        )
