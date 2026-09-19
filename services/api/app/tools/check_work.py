import re
from typing import Any

import sympy

from app.tools.base import Tool
from app.tools.symbolic_math import _parse, compute_eigenvalues, compute_rref, solve_math

# Instruction/filler words stripped from the problem statement before it's tested for
# "does this look like math" and handed to solve_math -- a student's problem is usually
# phrased as a sentence ("Solve 2x + 4 = 0 for x."), not a bare expression.
_INSTRUCTION_WORDS = re.compile(
    r"\b(solve|simplify|differentiate|integrate|factor|expand|find|compute|evaluate|"
    r"derivative of|integral of|for the variable \w+|for \w+|with respect to \w+|"
    r"what is|please|the equation|the expression|the matrix|"
    r"determinant of|eigenvalues? of|inverse of|null space of|nullspace of|kernel of|"
    r"reduced row echelon form of|reduced row echelon form|row reduce|row-reduce|the)\b",
    re.IGNORECASE,
)
_OPERATOR_CHARS = set("+-*/^=")
_MATH_FUNCS = ("sin", "cos", "tan", "log", "ln", "sqrt", "exp")


def _detect_operation(problem: str) -> str:
    lowered = problem.lower()
    if "eigenvalue" in lowered:
        return "eigenvalues"
    if "determinant" in lowered:
        return "determinant"
    if "inverse" in lowered:
        return "inverse"
    if "null space" in lowered or "nullspace" in lowered or "kernel" in lowered:
        return "null_space"
    if "rref" in lowered or "row echelon" in lowered:
        return "rref"
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
    # A matrix-shaped problem (e.g. "Matrix([[2, 1], [1, 2]])") has real math-looking
    # brackets/digits/commas but often no +-*/^= operator character at all -- an
    # unambiguous 'Matrix(' literal is its own strong enough signal on its own.
    has_matrix = "matrix(" in expression.lower()
    return has_func or has_matrix or (has_operator and has_digit)


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


def _compare_eigenvalues(expression: str, extracted: str) -> bool | None:
    """Eigenvalues are graded against the real {eigenvalue: multiplicity} SymPy
    computed via compute_eigenvalues -- not by re-parsing solve_math's own descriptive
    display string (which also carries the characteristic polynomial), and not by exact
    string match, since students typically list bare values like '1, 3'."""
    try:
        _, true_eigenvalues = compute_eigenvalues(expression)
    except Exception:
        return None

    parts = [p.strip() for p in re.split(r"[,;]|\band\b", extracted) if p.strip()]
    if not parts:
        return None
    try:
        student_values = [_parse(p) for p in parts]
    except Exception:
        return None

    true_values = list(true_eigenvalues.keys())
    if len(student_values) != len(true_values):
        # The number of eigenvalues (counted with multiplicity) is fixed by the
        # matrix's size -- listing the wrong count is a real, confident "incorrect",
        # not an ambiguous case to punt on.
        return False

    remaining = list(true_values)
    for student_value in student_values:
        match_index = next(
            (i for i, tv in enumerate(remaining) if sympy.simplify(student_value - tv) == 0),
            None,
        )
        if match_index is None:
            return False
        remaining.pop(match_index)
    return True


def _coerce_to_matrix(parsed):
    """A student naturally writes a vector/matrix as '[-2, 1]' or '[[1, 2], [0, 0]]',
    not SymPy's own 'Matrix([...])' literal -- `_parse` returns a bare Python list for
    that bracket syntax, not a MatrixBase, so convert it the same way sympy.Matrix(...)
    itself would (a flat list becomes a column vector; a list of lists becomes rows).
    Returns None if `parsed` isn't a matrix and isn't a list convertible to one."""
    if isinstance(parsed, list):
        try:
            return sympy.Matrix(parsed)
        except Exception:
            return None
    if isinstance(parsed, sympy.MatrixBase):
        return parsed
    return None


def _compare_rref(expression: str, extracted: str) -> bool | None:
    """Graded against the real rref matrix from compute_rref -- not by re-parsing
    solve_math's own descriptive display string (which also names the pivot columns),
    since that string isn't a bare sympify-able value the way determinant/inverse's
    answers are."""
    try:
        true_rref, _pivots = compute_rref(expression)
    except Exception:
        return None
    try:
        student_val = _coerce_to_matrix(_parse(extracted))
    except Exception:
        return None
    if student_val is None:
        return None
    if student_val.shape != true_rref.shape:
        return False
    try:
        diff = sympy.simplify(true_rref - student_val)
    except Exception:
        return None
    return bool(diff.is_zero_matrix)


def _compare_null_space(expression: str, extracted: str) -> bool | None:
    """A null space's basis isn't unique -- any nonzero vector v with A*v = 0 is a
    correct answer, not just whatever specific basis vector SymPy's nullspace()
    happened to compute. So this checks the actual defining property (A*v = 0, v != 0)
    against the real original matrix, rather than diffing against solve_math's
    displayed basis vector(s)."""
    try:
        matrix = _parse(expression)
    except Exception:
        return None
    if not isinstance(matrix, sympy.MatrixBase):
        return None
    try:
        student_val = _coerce_to_matrix(_parse(extracted))
    except Exception:
        return None
    if student_val is None:
        return None

    rows, cols = matrix.shape
    if student_val.shape == (cols, 1):
        vector = student_val
    elif student_val.shape == (1, cols):
        vector = student_val.T
    else:
        return False  # wrong dimension is unambiguously wrong, not a parse failure

    if vector.is_zero_matrix:
        return False  # the zero vector is never an acceptable "nontrivial" answer

    try:
        product = sympy.simplify(matrix * vector)
    except Exception:
        return None
    return bool(product.is_zero_matrix)


def _compare_final_answer(
    operation: str, expression: str, true_answer: str, student_work: str
) -> tuple[bool | None, str]:
    """Objective, symbolic (never hallucinated) comparison of the student's stated
    final answer against the verified ground truth. Returns (None, extracted) when
    nothing parseable could be pulled out of the student's work, so the caller can fall
    back to asking the model to compare manually instead of asserting a verdict."""
    extracted = _student_final_text(student_work)
    if not extracted:
        return None, extracted

    if operation == "eigenvalues":
        return _compare_eigenvalues(expression, extracted), extracted
    if operation == "null_space":
        return _compare_null_space(expression, extracted), extracted
    if operation == "rref":
        return _compare_rref(expression, extracted), extracted

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
            diff = true_val - student_val
            if isinstance(diff, sympy.MatrixBase):
                # determinant compares as plain scalars (handled by the branch below);
                # inverse and rref both compare as matrices, where `diff == 0` is
                # always False (comparing a Matrix to a bare int) even for a genuine
                # zero matrix -- is_zero_matrix is the real check.
                match = bool(sympy.simplify(diff).is_zero_matrix)
            else:
                match = sympy.simplify(diff) == 0
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

    correct, extracted = _compare_final_answer(operation, expression, true_answer, student_work)

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

    # A null space's basis vector isn't unique -- the student's own (different but
    # still valid) vector legitimately won't look like a "match" against whichever
    # basis vector solve_math happened to display, so say so explicitly rather than
    # letting that read as a contradiction.
    extra_note = (
        " (Any nonzero vector v with A*v = 0 is a valid null-space answer -- it "
        "doesn't need to be this exact vector, just satisfy that equation.)"
        if operation == "null_space"
        else ""
    )

    if correct:
        return (
            f"CORRECT. Verified via symbolic math: {operation} of '{expression}' = "
            f"{true_answer}, which matches the student's final answer ('{extracted}')."
            f"{extra_note} Give brief, encouraging confirmation -- no need to re-derive "
            "the whole solution for them."
        )

    return (
        f"INCORRECT. Verified via symbolic math: {operation} of '{expression}' = "
        f"{true_answer}, but the student's final answer ('{extracted}') does not match."
        f"{extra_note} Look at their shown work below and point to the exact step or "
        "claim where it first diverges from correct -- quote it, don't just hand back "
        "the right answer and let them diff it themselves.\n\n"
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
        "Checks a student's own TYPED answer/solution and reports specifically where "
        "it's right or wrong -- not a fresh re-solved answer to compare against. Math "
        "is verified via real symbolic computation, never guessed. Call when a "
        "student shares an attempt and asks if it's right or wants feedback. For a "
        "photo of handwritten work, use read_image instead."
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
