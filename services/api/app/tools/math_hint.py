from typing import Any

import sympy

from app.tools.base import Tool
from app.tools.symbolic_math import _OPERATIONS, _parse, solve_math

_APPROACH_HINTS = {
    "solve": (
        "think about what technique isolates the variable or finds its roots here -- "
        "e.g. straightforward algebraic isolation, factoring, or the quadratic "
        "formula, depending on the equation's shape."
    ),
    "differentiate": (
        "think about which differentiation rule matches this expression's structure "
        "-- e.g. the power rule, product rule, quotient rule, or chain rule."
    ),
    "integrate": (
        "think about which integration technique fits -- e.g. the power rule for "
        "integration, substitution, or recognizing a standard form."
    ),
    "simplify": "look for algebraic identities or common factors that let you combine or cancel terms.",
    "factor": (
        "look for a common factor, a recognizable pattern (difference of squares, "
        "perfect square trinomial), or grouping."
    ),
    "expand": (
        "think about distributing each term across the others systematically (e.g. "
        "FOIL for two binomials) rather than trying to do it all in one move."
    ),
}


def _first_step(operation: str, expression: str, variable: str) -> str:
    """The first concrete move, grounded in real sympy computation on a piece of the
    actual problem -- never a generic, made-up-sounding step."""
    var = sympy.Symbol(variable)

    if operation == "solve":
        if "=" in expression and "==" not in expression:
            lhs, rhs = expression.split("=", 1)
            expr = _parse(lhs) - _parse(rhs)
            return (
                f"First, move everything to one side of the equation: {expr} = 0. "
                f"Now solve for {variable} from there."
            )
        expr = _parse(expression)
        return f"This is already set up as {expr} = 0 -- solve for {variable} from there."

    expr = _parse(expression)

    if operation in ("differentiate", "integrate"):
        terms = sympy.Add.make_args(sympy.expand(expr))
        first_term = terms[0]
        if operation == "differentiate":
            piece = sympy.diff(first_term, var)
            verb = "Differentiating"
        else:
            piece = sympy.integrate(first_term, var)
            verb = "Integrating"
        if len(terms) > 1:
            return (
                f"Start with just the first term, {first_term}: {verb.lower()} it gives "
                f"{piece}. Then do the same to each remaining term and add the results "
                "together."
            )
        return f"{verb} {first_term} directly using the applicable rule is the whole computation here."

    if operation == "factor":
        expanded = sympy.expand(expr)
        return f"First write it in standard form: {expanded}. Now look for a common factor or a recognizable pattern."

    if operation == "expand":
        return (
            f"Take {expr} and start by distributing just its first term across the "
            "rest, then combine like terms as you go rather than doing it all at once."
        )

    if operation == "simplify":
        return f"Look at {expr} and see if any part of it matches a known identity you can substitute in first."

    return f"Take the first concrete manipulation on '{expression}' before trying to finish it in one move."


class GetMathHintTool(Tool):
    """Progressive, VERIFIED hints for a math problem -- grounded in real solve_math
    (SymPy) computation, so a hint is never wrong, unlike symbolic_math this is
    specifically for "I'm stuck, give me a nudge, not the answer.\""""

    name = "get_math_hint"
    description = (
        "Gives a progressive, verified hint for a math problem, grounded in real "
        "symbolic-math computation (never hallucinated) -- without just handing over "
        "the full answer. Call this when a student says they're stuck and want a "
        "nudge rather than a solved answer. hint_level 1 = a conceptual nudge about "
        "which technique applies (no numbers, no steps); 2 = the first concrete step; "
        "3 = the full worked answer."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "operation": {"type": "string", "enum": sorted(_OPERATIONS)},
            "expression": {
                "type": "string",
                "description": "e.g. 'x^2 + 3x - 4 = 0' for solve, or 'sin(x)*x^2' for differentiate",
            },
            "variable": {
                "type": "string",
                "description": "variable to solve/differentiate/integrate with respect to",
                "default": "x",
            },
            "hint_level": {
                "type": "integer",
                "enum": [1, 2, 3],
                "description": "1=conceptual nudge, 2=first concrete step, 3=full worked answer",
            },
        },
        "required": ["operation", "expression", "hint_level"],
    }

    async def run(self, operation: str, expression: str, hint_level: int, variable: str = "x") -> str:
        try:
            answer = solve_math(operation, expression, variable)
        except Exception as exc:
            return f"Error: {exc}"

        if hint_level <= 1:
            approach = _APPROACH_HINTS.get(
                operation, "think about which technique applies before doing any computation."
            )
            return f"Hint (level 1 -- approach only, no numbers): for '{expression}', {approach}"

        if hint_level == 2:
            try:
                first_step = _first_step(operation, expression, variable)
            except Exception:
                first_step = "Break the expression into smaller pieces and tackle the first one before the rest."
            return f"Hint (level 2 -- first concrete step): {first_step}"

        detail = f" with respect to {variable}" if operation in ("differentiate", "integrate", "solve") else ""
        return (
            f"Hint (level 3 -- full worked answer): {operation} of '{expression}'{detail} "
            f"= {answer}. Walk the student through how to get there rather than just "
            "stating it."
        )
