import json
from typing import Any

import numpy as np
import sympy
from sympy.parsing.sympy_parser import parse_expr

from app.tools.base import Tool
from app.tools.symbolic_math import _TRANSFORMATIONS

_DEFAULT_POINTS = 200
_MIN_VARY_STEPS = 2
_MAX_VARY_STEPS = 11


def _sample_curve(f: Any, x_min: float, x_max: float, num_points: int) -> tuple[list[float], list[float]]:
    """Shared numeric-sampling step for both the single-curve and per-position (vary)
    paths -- same drop-non-finite-points behavior either way."""
    xs = np.linspace(x_min, x_max, num_points)
    with np.errstate(all="ignore"):
        ys = np.array([f(x) for x in xs], dtype=float)
    finite = np.isfinite(ys)
    return xs[finite].tolist(), ys[finite].tolist()


def plot_function_spec(
    expression: str,
    variable: str = "x",
    x_min: float = -10.0,
    x_max: float = 10.0,
    num_points: int = _DEFAULT_POINTS,
    vary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Returns a Plotly.js-compatible figure spec (a plain dict — `data` + `layout`) for
    a single real-valued function of one variable. Samples numerically via a SymPy
    `lambdify`'d numpy function; points where the function is undefined or non-finite
    (division by zero, sqrt of a negative, etc.) are dropped rather than crashing, the
    same way a real graphing tool shows a discontinuity as a gap rather than an error.

    `vary` (optional -- the single-curve call path above is completely unchanged when
    omitted, and every pre-existing caller/test never passes it) is Learn Mode's
    manipulable-visualization hook (see app/agents/tutor.py's LEARN_MODE_SYSTEM_ADDENDUM):
    `{"symbol": "a", "min": 0.5, "max": 3.0, "steps": 6}`. `expression` may then contain
    `variable` AND `symbol` as free symbols (e.g. "a*x^2" varying "a"). One SymPy
    `.subs()` + `lambdify` + numpy-sampled curve is computed per discrete position
    (`steps`, evenly spaced across [min, max], 2-11 positions -- a real slider, not a
    smooth/continuous one, so dragging it client-side never needs a new network call or
    any JS math-evaluation library), returned as separate Plotly traces all sharing one
    figure, only the middle position initially `visible`. A top-level `sliders` field
    describes the parameter for the frontend (see PlotlyFigure.tsx): `label` and the
    index-aligned list of `values` each trace corresponds to, plus which index starts
    active.
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

    if vary is not None:
        try:
            vary_symbol = str(vary["symbol"])
            vary_min = float(vary["min"])
            vary_max = float(vary["max"])
            vary_steps = int(vary.get("steps", 5))
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"invalid 'vary' argument: {exc}") from exc

        if vary_symbol == variable:
            raise ValueError(f"vary.symbol ('{vary_symbol}') must differ from variable ('{variable}')")
        if vary_max <= vary_min:
            raise ValueError(f"vary.max ({vary_max}) must be greater than vary.min ({vary_min})")
        if not (_MIN_VARY_STEPS <= vary_steps <= _MAX_VARY_STEPS):
            raise ValueError(f"vary.steps must be between {_MIN_VARY_STEPS} and {_MAX_VARY_STEPS}")

        vary_sym = sympy.Symbol(vary_symbol)
        allowed = {var, vary_sym}
        if free_symbols and not free_symbols <= allowed:
            extra = ", ".join(str(s) for s in free_symbols - allowed)
            raise ValueError(
                f"expression has unexpected variable(s): {extra} "
                f"(expected only '{variable}' and '{vary_symbol}')"
            )

        vary_values = np.linspace(vary_min, vary_max, vary_steps).tolist()
        default_index = vary_steps // 2

        traces: list[dict[str, Any]] = []
        for i, value in enumerate(vary_values):
            try:
                f = sympy.lambdify(var, expr.subs(vary_sym, value), modules=["numpy"])
                xs_clean, ys_clean = _sample_curve(f, x_min, x_max, num_points)
            except Exception as exc:
                raise ValueError(f"could not evaluate '{expression}' at {vary_symbol}={value}: {exc}") from exc
            if not xs_clean:
                raise ValueError(
                    f"'{expression}' was undefined/non-finite across the whole [{x_min}, {x_max}] range "
                    f"at {vary_symbol}={value}"
                )
            traces.append(
                {
                    "x": xs_clean,
                    "y": ys_clean,
                    "type": "scatter",
                    "mode": "lines",
                    "name": f"{vary_symbol} = {value:g}",
                    "visible": i == default_index,
                }
            )

        return {
            "type": "plotly_figure",
            "data": traces,
            "layout": {
                "title": f"y = {expression}",
                "xaxis": {"title": variable},
                "yaxis": {"title": f"f({variable})"},
            },
            "sliders": [
                {
                    "label": vary_symbol,
                    "values": vary_values,
                    "active": default_index,
                }
            ],
        }

    if free_symbols and free_symbols != {var}:
        extra = ", ".join(str(s) for s in free_symbols - {var})
        raise ValueError(f"expression has unexpected variable(s): {extra} (expected only '{variable}')")

    try:
        f = sympy.lambdify(var, expr, modules=["numpy"])
        xs_clean, ys_clean = _sample_curve(f, x_min, x_max, num_points)
    except Exception as exc:
        raise ValueError(f"could not evaluate '{expression}': {exc}") from exc

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
        "describing the shape of the graph in words. Optionally pass `vary` (Learn Mode only — "
        "see the system prompt) to produce a slider-enabled plot instead of one static curve: "
        "{\"symbol\": \"a\", \"min\": 0.5, \"max\": 3, \"steps\": 6} for an expression like "
        "'a*x^2' that has a parameter worth letting the student explore interactively."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "expression": {"type": "string", "description": "e.g. 'x^2 - 3x + 2' or 'sin(x)/x'"},
            "variable": {"type": "string", "default": "x"},
            "x_min": {"type": "number", "default": -10},
            "x_max": {"type": "number", "default": 10},
            "vary": {
                "type": "object",
                "description": (
                    "Optional: name a free parameter in `expression` (distinct from `variable`) "
                    "to vary across a small discrete set of positions instead of plotting one "
                    "fixed curve, producing a slider-enabled chart."
                ),
                "properties": {
                    "symbol": {"type": "string", "description": "the parameter's symbol, e.g. 'a'"},
                    "min": {"type": "number"},
                    "max": {"type": "number"},
                    "steps": {"type": "integer", "default": 5, "description": "2-11 discrete positions"},
                },
                "required": ["symbol", "min", "max"],
            },
        },
        "required": ["expression"],
    }

    async def run(
        self,
        expression: str,
        variable: str = "x",
        x_min: float = -10,
        x_max: float = 10,
        vary: dict[str, Any] | None = None,
    ) -> str:
        try:
            spec = plot_function_spec(expression, variable, float(x_min), float(x_max), vary=vary)
        except Exception as exc:
            return f"Error: {exc}"
        return "```plotly-figure\n" + json.dumps(spec) + "\n```"
