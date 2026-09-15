from typing import Any

import sympy
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

from app.tools.base import Tool

_TRANSFORMATIONS = standard_transformations + (convert_xor, implicit_multiplication_application)
_OPERATIONS = {"simplify", "solve", "differentiate", "integrate", "factor", "expand"}


def _parse(expression: str):
    """`^` means power (not XOR) and `2x` means `2*x` here — natural-math input, not
    strict Python syntax, since this is meant to take whatever a model/student typed."""
    return parse_expr(expression, transformations=_TRANSFORMATIONS)


def solve_math(operation: str, expression: str, variable: str = "x") -> str:
    if operation not in _OPERATIONS:
        raise ValueError(f"unknown operation '{operation}', expected one of {sorted(_OPERATIONS)}")

    var = sympy.Symbol(variable)
    try:
        if operation == "solve" and "=" in expression and "==" not in expression:
            lhs, rhs = expression.split("=", 1)
            expr = _parse(lhs) - _parse(rhs)
        else:
            expr = _parse(expression)
    except Exception as exc:
        raise ValueError(f"could not parse '{expression}': {exc}") from exc

    try:
        if operation == "simplify":
            result = sympy.simplify(expr)
        elif operation == "solve":
            result = sympy.solve(expr, var)
        elif operation == "differentiate":
            result = sympy.diff(expr, var)
        elif operation == "integrate":
            result = sympy.integrate(expr, var)
        elif operation == "factor":
            result = sympy.factor(expr)
        elif operation == "expand":
            result = sympy.expand(expr)
    except Exception as exc:
        raise ValueError(f"could not {operation} '{expression}': {exc}") from exc

    return str(result)


class SymbolicMathTool(Tool):
    name = "symbolic_math"
    description = (
        "Exact symbolic math (SymPy): solve, differentiate, integrate, simplify, "
        "factor, or expand. Use instead of doing symbolic/exact math by hand."
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
        },
        "required": ["operation", "expression"],
    }

    async def run(self, operation: str, expression: str, variable: str = "x") -> str:
        try:
            return solve_math(operation, expression, variable)
        except Exception as exc:
            return f"Error: {exc}"
