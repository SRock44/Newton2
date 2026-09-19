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
_ALGEBRA_OPERATIONS = {"simplify", "solve", "differentiate", "integrate", "factor", "expand"}
# Real linear algebra (SymPy's own Matrix methods -- never hand-rolled or approximated).
# A matrix is given using SymPy's own literal syntax, e.g. 'Matrix([[1, 2], [3, 4]])' --
# `_parse` below already evaluates that safely (see its docstring), so no second,
# separate parsing path was needed for this.
_MATRIX_OPERATIONS = {"determinant", "inverse", "eigenvalues", "rref", "null_space"}
_OPERATIONS = _ALGEBRA_OPERATIONS | _MATRIX_OPERATIONS


def _parse(expression: str):
    """`^` means power (not XOR) and `2x` means `2*x` here — natural-math input, not
    strict Python syntax, since this is meant to take whatever a model/student typed.

    This already safely handles SymPy's own `Matrix([[1, 2], [3, 4]])` literal syntax
    too: parse_expr's default namespace (used whenever no explicit global_dict is
    passed) is built from `from sympy import *`, which includes `Matrix` -- confirmed
    directly rather than assumed. No second, unsafe eval path is needed for matrices."""
    return parse_expr(expression, transformations=_TRANSFORMATIONS)


def _parse_matrix(expression: str) -> sympy.MatrixBase:
    """Parses `expression` via the same safe `_parse` every other operation uses, and
    confirms the result is actually a matrix (rather than, say, a plain algebraic
    expression handed to a linear-algebra operation by mistake)."""
    try:
        parsed = _parse(expression)
    except Exception as exc:
        raise ValueError(f"could not parse '{expression}': {exc}") from exc
    if not isinstance(parsed, sympy.MatrixBase):
        raise ValueError(
            f"'{expression}' is not a matrix -- use SymPy's own literal syntax, e.g. "
            "'Matrix([[1, 2], [3, 4]])'"
        )
    return parsed


def compute_determinant(expression: str) -> sympy.Expr:
    return _parse_matrix(expression).det()


def compute_inverse(expression: str) -> sympy.MatrixBase:
    matrix = _parse_matrix(expression)
    if matrix.det() == 0:
        raise ValueError(f"matrix '{expression}' is singular (determinant = 0) -- it has no inverse")
    return matrix.inv()


def compute_eigenvalues(expression: str) -> tuple[sympy.Expr, dict]:
    """Returns (characteristic polynomial as an expression in lambda, {eigenvalue:
    algebraic multiplicity}) -- both real SymPy computations (`.charpoly()` /
    `.eigenvals()`), not just a bare final list, since the characteristic polynomial is
    how the answer is normally checked/derived by hand."""
    matrix = _parse_matrix(expression)
    lam = sympy.Symbol("lambda")
    charpoly = matrix.charpoly(lam).as_expr()
    return charpoly, matrix.eigenvals()


def compute_rref(expression: str) -> tuple[sympy.MatrixBase, tuple[int, ...]]:
    return _parse_matrix(expression).rref()


def compute_null_space(expression: str) -> list[sympy.MatrixBase]:
    return _parse_matrix(expression).nullspace()


def solve_math(operation: str, expression: str, variable: str = "x") -> str:
    if operation not in _OPERATIONS:
        raise ValueError(f"unknown operation '{operation}', expected one of {sorted(_OPERATIONS)}")

    if operation in _MATRIX_OPERATIONS:
        try:
            if operation == "determinant":
                return str(compute_determinant(expression))
            if operation == "inverse":
                return str(compute_inverse(expression))
            if operation == "eigenvalues":
                charpoly, eigenvalues = compute_eigenvalues(expression)
                pretty = ", ".join(
                    f"{value} (multiplicity {mult})" for value, mult in eigenvalues.items()
                )
                return (
                    f"characteristic polynomial: det(A - lambda*I) = {charpoly} = 0; "
                    f"eigenvalues: {pretty}"
                )
            if operation == "rref":
                rref_matrix, pivots = compute_rref(expression)
                return f"rref: {rref_matrix}; pivot columns: {pivots}"
            if operation == "null_space":
                basis = compute_null_space(expression)
                if not basis:
                    return "null space: {zero vector only} -- matrix has full column rank (trivial null space)"
                vectors = "; ".join(str(vector.T.tolist()[0]) for vector in basis)
                return f"null space basis vector(s): {vectors}"
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError(f"could not {operation} '{expression}': {exc}") from exc
        raise AssertionError("unreachable")  # every _MATRIX_OPERATIONS case returns above

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
        "factor, or expand -- plus real linear algebra: determinant, inverse, "
        "eigenvalues (with the characteristic polynomial), rref (reduced row echelon "
        "form), and null_space, given a matrix as a SymPy literal like "
        "'Matrix([[1, 2], [3, 4]])'. Use instead of doing symbolic/exact math (or "
        "linear algebra) by hand."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "operation": {"type": "string", "enum": sorted(_OPERATIONS)},
            "expression": {
                "type": "string",
                "description": (
                    "e.g. 'x^2 + 3x - 4 = 0' for solve, 'sin(x)*x^2' for differentiate, "
                    "or 'Matrix([[1, 2], [3, 4]])' for determinant/inverse/eigenvalues/"
                    "rref/null_space"
                ),
            },
            "variable": {
                "type": "string",
                "description": "variable to solve/differentiate/integrate with respect to (ignored for matrix operations)",
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
