import json
from typing import Any

import numpy as np
import sympy
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

from app.tools.base import Tool

_TRANSFORMATIONS = standard_transformations + (convert_xor, implicit_multiplication_application)
_DEFAULT_POINTS = 200


def plot_function_spec(
    expression: str,
    variable: str = "x",
    x_min: float = -10.0,
    x_max: float = 10.0,
    num_points: int = _DEFAULT_POINTS,
) -> dict[str, Any]:
    """Returns a Plotly.js-compatible figure spec (a plain dict — `data` + `layout`) for
    a single real-valued function of one variable. Samples numerically via a SymPy
    `lambdify`'d numpy function; points where the function is undefined or non-finite
    (division by zero, sqrt of a negative, etc.) are dropped rather than crashing, the
    same way a real graphing tool shows a discontinuity as a gap rather than an error.
    """
    if x_max <= x_min:
        raise ValueError(f"x_max ({x_max}) must be greater than x_min ({x_min})")
    if not (2 <= num_points <= 5000):
        raise ValueError("num_points must be between 2 and 5000")

    var = sympy.Symbol(variable)
    try:
        expr = parse_expr(expression, transformations=_TRANSFORMATIONS)
    except Exception as exc:
        raise ValueError(f"could not parse '{expression}': {exc}") from exc

    free_symbols = expr.free_symbols
    if free_symbols and free_symbols != {var}:
        extra = ", ".join(str(s) for s in free_symbols - {var})
        raise ValueError(f"expression has unexpected variable(s): {extra} (expected only '{variable}')")

    try:
        f = sympy.lambdify(var, expr, modules=["numpy"])
        xs = np.linspace(x_min, x_max, num_points)
        with np.errstate(all="ignore"):
            ys = np.array([f(x) for x in xs], dtype=float)
    except Exception as exc:
        raise ValueError(f"could not evaluate '{expression}': {exc}") from exc

    finite = np.isfinite(ys)
    xs_clean = xs[finite].tolist()
    ys_clean = ys[finite].tolist()

    if not xs_clean:
        raise ValueError(f"'{expression}' was undefined/non-finite across the whole [{x_min}, {x_max}] range")

    return {
        "type": "plotly_figure",
        "data": [
            {
                "x": xs_clean,
                "y": ys_clean,
                "type": "scatter",
                "mode": "lines",
                "name": expression,
            }
        ],
        "layout": {
            "title": f"y = {expression}",
            "xaxis": {"title": variable},
            "yaxis": {"title": f"f({variable})"},
        },
    }


class VisualizerTool(Tool):
    name = "plot_function"
    description = (
        "Generate an interactive plot of a real-valued function of one variable over a range "
        "(e.g. 'sin(x)/x' from -10 to 10). Returns a Plotly.js figure spec as JSON — include it "
        "verbatim in a fenced ```plotly-figure code block so the app can render it, rather than "
        "describing the shape of the graph in words."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "expression": {"type": "string", "description": "e.g. 'x^2 - 3x + 2' or 'sin(x)/x'"},
            "variable": {"type": "string", "default": "x"},
            "x_min": {"type": "number", "default": -10},
            "x_max": {"type": "number", "default": 10},
        },
        "required": ["expression"],
    }

    async def run(
        self, expression: str, variable: str = "x", x_min: float = -10, x_max: float = 10
    ) -> str:
        try:
            spec = plot_function_spec(expression, variable, float(x_min), float(x_max))
        except Exception as exc:
            return f"Error: {exc}"
        return "```plotly-figure\n" + json.dumps(spec) + "\n```"
