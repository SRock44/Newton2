"""Real, computed NUMERIC methods -- the deliberate complement to symbolic_math's
exact linear algebra (determinant/inverse/eigenvalues/rref/null_space), not a
replacement for it.

symbolic_math's linear algebra is SymPy: exact, symbolic, closed-form. That's the
right tool for a clean textbook matrix with integer/rational entries where the point
IS the exact answer. It is the WRONG tool for the matrices real engineering
coursework (statics, circuits, structural analysis) actually produces: measured or
decimal coefficients, often ill-conditioned, where a "closed form" is either not
what's being asked for or actively misleading about how trustworthy the digits are.
This module is numpy.linalg / scipy.optimize / scipy.integrate -- real floating-point
numerical methods, the same family of algorithms an engineering student would reach
for in MATLAB/numpy, including the thing symbolic computation can't tell you at all:
a condition number, a convergence flag, a numeric ODE trajectory.

Runs in-process in the api service, exactly like chemistry.py's SymPy calls -- never
inside sandbox-runner, whose 300MB memory limit (a deliberate security boundary for
untrusted-code execution) was tested and cannot fit numpy/scipy.

What this handles, honestly:
  * solve_linear_system -- numpy.linalg.solve for a square Ax=b, with the real
    condition number (numpy.linalg.cond) reported and an honest warning when it's
    large, instead of silently handing back digits that aren't trustworthy.
  * eigenvalues_numeric -- numpy.linalg.eig for a general (possibly non-symmetric,
    non-diagonalizable-by-hand) square matrix; real (possibly complex) numeric
    eigenvalues/eigenvectors, not a characteristic polynomial.
  * root_find -- scipy.optimize.brentq (given a bracketing interval) or
    scipy.optimize.fsolve (given an initial guess) for a real-valued function of one
    variable, reusing symbolic_math's own safe expression parser (never a second,
    parallel parser) and sympy.lambdify to turn that parsed expression into a fast
    numeric callable.
  * integrate_ode -- scipy.integrate.solve_ivp for a first-order ODE or system,
    right-hand side(s) parsed the same lambdify-from-symbolic_math's-parser way, with
    a hard cap on the integration window and a bounded max step so a pathological
    input can't run long.
  * curve_fit -- scipy.optimize.curve_fit fitting a parsed+lambdified model to given
    x/y data, with a real R^2 goodness-of-fit measure.

What it does NOT handle (deliberate, documented gaps -- it says so rather than
guessing):
  * Non-square systems in solve_linear_system (no silent least-squares fallback --
    numpy.linalg.solve needs a square system; say so instead of guessing which kind
    of "solution" was wanted).
  * Root-finding or curve-fitting in more than one unknown.
  * Stiff or long-horizon ODE integrations beyond the capped window -- this is meant
    for fast, in-process, single-tool-call use, not a long-running solver.
  * Anything symbolic/exact -- that's symbolic_math's job; this module never returns
    a closed-form answer, only a numeric one, and says so.
"""

from typing import Any

import numpy as np
import scipy.integrate
import scipy.optimize
import sympy

from app.tools.base import Tool
from app.tools.symbolic_math import _parse, _parse_matrix

_OPERATIONS = {
    "solve_linear_system",
    "eigenvalues_numeric",
    "root_find",
    "integrate_ode",
    "curve_fit",
}

# Rule-of-thumb numerical-analysis thresholds for numpy.linalg.cond's 2-norm
# condition number: roughly log10(cond) significant decimal digits are lost to
# floating-point rounding when solving Ax=b. Not exact science, but the real,
# standard rule engineers are taught -- reported honestly as a warning, never
# silently swallowed.
_ILL_CONDITIONED_THRESHOLD = 1e4
_SEVERELY_ILL_CONDITIONED_THRESHOLD = 1e12

# A hard cap on integrate_ode's time window -- keeps this tool inside "fast, in-
# process, one round-trip" (see this module's docstring); nothing legitimate for a
# tutoring session needs a longer span than this.
_MAX_ODE_DURATION = 1.0e6


def _fmt(x: float) -> str:
    return f"{float(x):.6g}"


def _fmt_complex(z: complex) -> str:
    z = complex(z)
    if abs(z.imag) < 1e-9 * max(1.0, abs(z.real)):
        return _fmt(z.real)
    sign = "+" if z.imag >= 0 else "-"
    return f"{_fmt(z.real)} {sign} {_fmt(abs(z.imag))}i"


def _floats_csv(text: str, name: str) -> list[float]:
    if not text.strip():
        raise ValueError(f"missing `{name}`")
    parts = [p.strip() for p in text.split(",")]
    try:
        return [float(p) for p in parts]
    except ValueError as exc:
        raise ValueError(f"could not read `{name}` = '{text}' as comma-separated numbers") from exc


def _matrix_to_numpy(expression: str, name: str = "matrix") -> np.ndarray:
    """Parses `expression` via symbolic_math's own safe `_parse`/`_parse_matrix` (the
    same 'Matrix([[1, 2], [3, 4]])' literal syntax symbolic_math's linear algebra
    already uses), then confirms every entry is an actual number -- a matrix with a
    free symbol in it isn't something numpy.linalg can solve at all."""
    if not expression.strip():
        raise ValueError(f"missing `{name}`")
    try:
        matrix = _parse_matrix(expression)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"could not parse `{name}` '{expression}': {exc}") from exc
    try:
        return np.array([[float(entry) for entry in row] for row in matrix.tolist()], dtype=float)
    except TypeError as exc:
        raise ValueError(
            f"`{name}` '{expression}' contains a symbol, not a concrete number -- numeric_methods "
            "needs actual numeric entries (use symbolic_math if the matrix has unknowns in it)"
        ) from exc


# ---------------------------------------------------------------------------
# solve_linear_system
# ---------------------------------------------------------------------------


def solve_linear_system(matrix: str, vector: str) -> dict[str, Any]:
    if not vector.strip():
        raise ValueError(
            "solve_linear_system needs `matrix` (e.g. 'Matrix([[3, 1], [1, 2]])') and "
            "`vector` (e.g. '9, 8')"
        )
    a = _matrix_to_numpy(matrix, "matrix")
    if a.shape[0] != a.shape[1]:
        raise ValueError(
            f"`matrix` is {a.shape[0]}x{a.shape[1]}, not square -- numpy.linalg.solve needs a "
            "square system (as many equations as unknowns). This operation deliberately does not "
            "guess a least-squares answer for an over/under-determined system."
        )
    b = np.array(_floats_csv(vector, "vector"), dtype=float)
    if b.shape[0] != a.shape[0]:
        raise ValueError(f"`vector` has {b.shape[0]} entries but `matrix` has {a.shape[0]} rows -- they must match")

    try:
        cond = float(np.linalg.cond(a))
    except np.linalg.LinAlgError:
        cond = float("inf")

    try:
        x = np.linalg.solve(a, b)
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            f"`matrix` is numerically singular: {exc}. No unique solution exists -- there's a "
            "dependent row/column; symbolic_math's null_space or rref operation can show exactly "
            "why."
        ) from exc

    return {
        "x": x,
        "cond": cond,
        "ill_conditioned": cond >= _ILL_CONDITIONED_THRESHOLD,
        "severely_ill_conditioned": cond >= _SEVERELY_ILL_CONDITIONED_THRESHOLD,
    }


# ---------------------------------------------------------------------------
# eigenvalues_numeric
# ---------------------------------------------------------------------------


def eigenvalues_numeric(matrix: str) -> dict[str, Any]:
    a = _matrix_to_numpy(matrix, "matrix")
    if a.shape[0] != a.shape[1]:
        raise ValueError(
            f"`matrix` is {a.shape[0]}x{a.shape[1]}, not square -- eigenvalues are only defined "
            "for square matrices"
        )
    try:
        eigenvalues, eigenvectors = np.linalg.eig(a)
    except np.linalg.LinAlgError as exc:
        raise ValueError(f"the eigenvalue computation did not converge: {exc}") from exc
    return {"eigenvalues": eigenvalues, "eigenvectors": eigenvectors, "n": a.shape[0]}


# ---------------------------------------------------------------------------
# root_find -- reuses symbolic_math's own safe parser + sympy.lambdify, never a
# second, parallel expression parser.
# ---------------------------------------------------------------------------


def _lambdify_scalar(expression: str, variable: str):
    try:
        expr = _parse(expression)
    except Exception as exc:
        raise ValueError(f"could not parse '{expression}': {exc}") from exc
    var = sympy.Symbol(variable)
    return sympy.lambdify(var, expr, modules=["numpy"])


def root_find(expression: str, variable: str = "x", bracket: str = "", initial_guess: str = "") -> dict[str, Any]:
    if not expression.strip():
        raise ValueError("root_find needs `expression`, e.g. 'x^3 - x - 2'")
    if not bracket.strip() and not initial_guess.strip():
        raise ValueError(
            "root_find needs either `bracket` ('low, high', for scipy.optimize.brentq) or "
            "`initial_guess` (a single number, for scipy.optimize.fsolve)"
        )

    func = _lambdify_scalar(expression, variable)

    if bracket.strip():
        values = _floats_csv(bracket, "bracket")
        if len(values) != 2:
            raise ValueError(f"`bracket` needs exactly two numbers 'low, high', got '{bracket}'")
        lo, hi = values
        try:
            f_lo, f_hi = float(func(lo)), float(func(hi))
        except Exception as exc:
            raise ValueError(f"could not evaluate '{expression}' at the bracket endpoints: {exc}") from exc
        if f_lo == 0.0:
            return {"root": lo, "method": "brentq", "residual": 0.0}
        if f_hi == 0.0:
            return {"root": hi, "method": "brentq", "residual": 0.0}
        if (f_lo > 0) == (f_hi > 0):
            raise ValueError(
                f"f({_fmt(lo)}) = {_fmt(f_lo)} and f({_fmt(hi)}) = {_fmt(f_hi)} have the same sign -- "
                "brentq needs a real sign change across the bracket to guarantee a root inside it. "
                "Try a different interval, or use `initial_guess` with fsolve instead."
            )
        try:
            root = float(scipy.optimize.brentq(func, lo, hi, xtol=1e-12, maxiter=200))
        except Exception as exc:
            raise ValueError(f"brentq failed to find a root in [{_fmt(lo)}, {_fmt(hi)}]: {exc}") from exc
        return {
            "root": root,
            "method": "brentq (bracketed, bisection-based)",
            "residual": float(func(root)),
            "bracket": (lo, hi),
        }

    values = _floats_csv(initial_guess, "initial_guess")
    if len(values) != 1:
        raise ValueError("`initial_guess` for root_find needs a single number")
    x0 = values[0]
    result, _infodict, ier, mesg = scipy.optimize.fsolve(func, x0, full_output=True, maxfev=200)
    if ier != 1:
        raise ValueError(f"fsolve did not converge from initial guess {_fmt(x0)}: {mesg.strip()}")
    root = float(result[0])
    return {
        "root": root,
        "method": "fsolve (Newton-based, from an initial guess)",
        "residual": float(func(root)),
        "initial_guess": x0,
    }


# ---------------------------------------------------------------------------
# integrate_ode -- same parser/lambdify reuse.
# ---------------------------------------------------------------------------


def integrate_ode(
    expression: str,
    state_variables: str = "y",
    initial_conditions: str = "",
    t_span: str = "",
) -> dict[str, Any]:
    if not expression.strip():
        raise ValueError(
            "integrate_ode needs `expression`, the right-hand side(s) of dy/dt = f(t, y), e.g. "
            "'-0.5*y' for exponential decay"
        )
    if not initial_conditions.strip():
        raise ValueError("integrate_ode needs `initial_conditions`, e.g. '1' or '1, 0' for a system")
    if not t_span.strip():
        raise ValueError("integrate_ode needs `t_span`, e.g. '0, 10'")

    names = [n.strip() for n in state_variables.split(",") if n.strip()]
    if not names:
        raise ValueError("`state_variables` cannot be empty")
    rhs_strings = [r.strip() for r in expression.split(",") if r.strip()]
    if len(rhs_strings) != len(names):
        raise ValueError(
            f"{len(names)} state variable(s) ({', '.join(names)}) but {len(rhs_strings)} "
            "right-hand-side expression(s) in `expression` -- give one comma-separated RHS per "
            "state variable, in the same order"
        )

    t_symbol = sympy.Symbol("t")
    state_symbols = [sympy.Symbol(n) for n in names]
    try:
        exprs = [_parse(r) for r in rhs_strings]
    except Exception as exc:
        raise ValueError(f"could not parse the right-hand side(s) '{expression}': {exc}") from exc
    funcs = [sympy.lambdify((t_symbol, *state_symbols), e, modules=["numpy"]) for e in exprs]

    y0 = _floats_csv(initial_conditions, "initial_conditions")
    if len(y0) != len(names):
        raise ValueError(
            f"{len(names)} state variable(s) but {len(y0)} initial condition(s) -- need exactly one per state variable"
        )

    span = _floats_csv(t_span, "t_span")
    if len(span) != 2:
        raise ValueError(f"`t_span` needs exactly two numbers 'start, end', got '{t_span}'")
    t0, t1 = span
    if t1 <= t0:
        raise ValueError(f"`t_span` end ({_fmt(t1)}) must be after its start ({_fmt(t0)})")
    duration = t1 - t0
    if duration > _MAX_ODE_DURATION:
        raise ValueError(
            f"t_span of {duration:.3g} is far longer than this tool integrates -- keep the window "
            f"bounded (<= {_MAX_ODE_DURATION:.0g}); this is meant for a fast, single-tool-call answer, "
            "not a long-running solve"
        )

    def rhs(t, y):
        return [f(t, *y) for f in funcs]

    n_points = int(min(200, max(20, duration * 10)))
    t_eval = np.linspace(t0, t1, n_points)
    max_step = duration / 100.0

    try:
        sol = scipy.integrate.solve_ivp(
            rhs,
            (t0, t1),
            y0,
            method="RK45",
            t_eval=t_eval,
            max_step=max_step,
            rtol=1e-8,
            atol=1e-10,
        )
    except Exception as exc:
        raise ValueError(f"could not integrate this ODE: {exc}") from exc
    if not sol.success:
        raise ValueError(f"the ODE solver did not complete successfully: {sol.message}")

    return {
        "t": sol.t,
        "y": sol.y,
        "y_final": sol.y[:, -1],
        "names": names,
        "t0": t0,
        "t1": t1,
        "n_steps": len(sol.t),
    }


# ---------------------------------------------------------------------------
# curve_fit -- same parser/lambdify reuse.
# ---------------------------------------------------------------------------


def curve_fit_data(
    expression: str,
    x_data: str,
    y_data: str,
    variable: str = "x",
    parameters: str = "",
    initial_guess: str = "",
) -> dict[str, Any]:
    if not expression.strip():
        raise ValueError(
            "curve_fit needs `expression`, the model as a function of `variable` and the fit "
            "`parameters`, e.g. 'a*exp(b*x) + c'"
        )
    if not parameters.strip():
        raise ValueError("curve_fit needs `parameters`, the names of the fit parameters in `expression`, e.g. 'a, b, c'")
    if not x_data.strip() or not y_data.strip():
        raise ValueError("curve_fit needs `x_data` and `y_data`, matching comma-separated lists of numbers")

    xs = np.array(_floats_csv(x_data, "x_data"), dtype=float)
    ys = np.array(_floats_csv(y_data, "y_data"), dtype=float)
    if xs.shape[0] != ys.shape[0]:
        raise ValueError(f"`x_data` has {xs.shape[0]} point(s) but `y_data` has {ys.shape[0]} -- they must match")

    param_names = [p.strip() for p in parameters.split(",") if p.strip()]
    if not param_names:
        raise ValueError("`parameters` cannot be empty")
    if xs.shape[0] < len(param_names):
        raise ValueError(
            f"only {xs.shape[0]} data point(s) for {len(param_names)} parameter(s) -- underdetermined "
            "(there are infinitely many fits that pass exactly through them); give at least as many "
            "points as parameters"
        )

    var_symbol = sympy.Symbol(variable)
    param_symbols = [sympy.Symbol(p) for p in param_names]
    try:
        expr = _parse(expression)
    except Exception as exc:
        raise ValueError(f"could not parse '{expression}': {exc}") from exc
    model = sympy.lambdify((var_symbol, *param_symbols), expr, modules=["numpy"])

    def model_func(x, *params):
        return model(x, *params)

    if initial_guess.strip():
        p0 = _floats_csv(initial_guess, "initial_guess")
        if len(p0) != len(param_names):
            raise ValueError(f"`initial_guess` has {len(p0)} value(s) but there are {len(param_names)} parameter(s)")
    else:
        p0 = [1.0] * len(param_names)

    try:
        popt, pcov = scipy.optimize.curve_fit(model_func, xs, ys, p0=p0, maxfev=5000)
    except RuntimeError as exc:
        raise ValueError(f"curve_fit did not converge to a solution: {exc}") from exc
    except Exception as exc:
        raise ValueError(f"could not fit '{expression}' to the given data: {exc}") from exc

    y_pred = np.asarray(model_func(xs, *popt), dtype=float)
    residuals = ys - y_pred
    ss_res = float(np.sum(residuals**2))
    ss_tot = float(np.sum((ys - np.mean(ys)) ** 2))
    r_squared = (1.0 - ss_res / ss_tot) if ss_tot > 0 else None
    perr = np.sqrt(np.diag(pcov)) if pcov is not None else np.full(len(popt), float("nan"))

    return {
        "param_names": param_names,
        "popt": popt,
        "perr": perr,
        "r_squared": r_squared,
        "ss_res": ss_res,
    }


# ---------------------------------------------------------------------------
# The single tutor-facing entry point
# ---------------------------------------------------------------------------


def solve_numeric(
    operation: str,
    matrix: str = "",
    vector: str = "",
    expression: str = "",
    variable: str = "x",
    state_variables: str = "y",
    initial_conditions: str = "",
    t_span: str = "",
    parameters: str = "",
    initial_guess: str = "",
    bracket: str = "",
    x_data: str = "",
    y_data: str = "",
) -> str:
    if operation not in _OPERATIONS:
        raise ValueError(f"unknown operation '{operation}', expected one of {sorted(_OPERATIONS)}")

    if operation == "solve_linear_system":
        r = solve_linear_system(matrix, vector)
        x_str = ", ".join(f"x{i + 1} = {_fmt(v)}" for i, v in enumerate(r["x"]))
        lines = [
            f"Solved numerically with numpy.linalg.solve: {x_str}.",
            f"Condition number (numpy.linalg.cond): {_fmt(r['cond'])}.",
        ]
        if r["severely_ill_conditioned"]:
            lines.append(
                "WARNING: this condition number is so large the system is numerically nearly "
                "singular -- treat these digits as unreliable, not just imprecise. A tiny change "
                "in the inputs (measurement noise, rounding) could produce a wildly different "
                "'solution'. Check the problem for a near-dependent row/equation."
            )
        elif r["ill_conditioned"]:
            import math

            lost_digits = math.log10(r["cond"])
            lines.append(
                f"WARNING: this system is ill-conditioned (cond >= {_ILL_CONDITIONED_THRESHOLD:.0g}) -- "
                f"expect roughly the last {lost_digits:.0f} significant digits of this answer to be "
                "unreliable due to floating-point rounding, even though the computation itself is exact "
                "arithmetic on the inputs given. This is exactly the case symbolic_math's closed-form "
                "solve isn't built for: real (measured/decimal) coefficients where sensitivity to "
                "rounding is the point."
            )
        else:
            lines.append("Well-conditioned; no numerical accuracy warning.")
        return "\n".join(lines)

    if operation == "eigenvalues_numeric":
        r = eigenvalues_numeric(matrix)
        eig_str = ", ".join(_fmt_complex(v) for v in r["eigenvalues"])
        vec_lines = []
        for i, val in enumerate(r["eigenvalues"]):
            vec = r["eigenvectors"][:, i]
            vec_str = ", ".join(_fmt_complex(c) for c in vec)
            vec_lines.append(f"  eigenvalue {_fmt_complex(val)}: eigenvector ({vec_str})")
        return (
            f"Numeric eigenvalues (numpy.linalg.eig, a general {r['n']}x{r['n']} matrix -- no "
            "symmetry or niceness assumed, unlike symbolic_math's exact eigenvalues operation): "
            f"{eig_str}.\n"
            "Eigenvectors (each normalized to unit length, matched to its eigenvalue above):\n"
            + "\n".join(vec_lines)
            + "\nComplex eigenvalues indicate rotation/oscillation in the underlying system rather "
            "than a real closed form -- report them as-is rather than discarding the imaginary part."
        )

    if operation == "root_find":
        r = root_find(expression, variable, bracket, initial_guess)
        return (
            f"Numeric root of '{expression}' via scipy.optimize's {r['method']}: "
            f"{variable} = {_fmt(r['root'])} (residual f({variable}) = {_fmt(r['residual'])}, "
            "effectively zero to solver tolerance)."
        )

    if operation == "integrate_ode":
        r = integrate_ode(expression, state_variables, initial_conditions, t_span)
        final_str = ", ".join(f"{name}({_fmt(r['t1'])}) = {_fmt(v)}" for name, v in zip(r["names"], r["y_final"]))
        return (
            f"Numerically integrated dy/dt = {expression} from t = {_fmt(r['t0'])} to "
            f"t = {_fmt(r['t1'])} via scipy.integrate.solve_ivp (RK45, adaptive step, capped "
            f"max_step = {(r['t1'] - r['t0']) / 100.0:.4g}), {r['n_steps']} reported points.\n"
            f"ANSWER: {final_str}.\n"
            "This is a numeric trajectory, not a closed-form solution -- compare against an exact "
            "solve (symbolic_math) when one exists to check it, but don't expect this tool to hand "
            "back a formula."
        )

    r = curve_fit_data(expression, x_data, y_data, variable, parameters, initial_guess)
    params_str = ", ".join(
        f"{name} = {_fmt(v)} (+/- {_fmt(e)})" for name, v, e in zip(r["param_names"], r["popt"], r["perr"])
    )
    r2_str = f"{r['r_squared']:.6g}" if r["r_squared"] is not None else "undefined (all y-values identical)"
    return (
        f"Fitted '{expression}' to {len(_floats_csv(x_data, 'x_data'))} data point(s) via "
        f"scipy.optimize.curve_fit: {params_str}.\n"
        f"R^2 = {r2_str}; sum of squared residuals = {_fmt(r['ss_res'])}.\n"
        "A high R^2 says this model form fits well; it does not by itself say the model form is "
        "the right physical one to be fitting."
    )


class NumericMethodsTool(Tool):
    """The numeric counterpart to symbolic_math's exact linear algebra: real
    numpy.linalg/scipy.optimize/scipy.integrate computation for the ill-conditioned,
    non-nice, or genuinely non-closed-form problems real engineering coursework
    produces -- a condition number instead of a silently-untrustworthy exact answer,
    a numeric eigenvalue instead of a characteristic polynomial nobody asked for, a
    real root/ODE trajectory/curve fit instead of an LLM guess at one."""

    name = "numeric_methods"
    description = (
        "Real NUMERIC computation (numpy.linalg / scipy.optimize / scipy.integrate), "
        "for when a closed-form/exact symbolic answer either isn't the point or isn't "
        "trustworthy -- the complement to symbolic_math's exact linear algebra, not a "
        "replacement for it. Operations: solve_linear_system (numpy.linalg.solve for a "
        "square Ax=b, with the real condition number and an honest ill-conditioning "
        "warning), eigenvalues_numeric (numpy.linalg.eig for a general, possibly "
        "non-symmetric matrix's numeric eigenvalues/eigenvectors), root_find "
        "(scipy.optimize.brentq given a bracket, or fsolve given an initial guess, for "
        "a real-valued function of one variable), integrate_ode (scipy.integrate."
        "solve_ivp for a first-order ODE or system given its right-hand side(s), "
        "initial conditions, and time span), and curve_fit (scipy.optimize.curve_fit "
        "of a model to x/y data, with a real R^2). Use for ill-conditioned, "
        "real/decimal-coefficient, or non-closed-form problems (statics, circuits, "
        "structural analysis, physical-system ODEs, fitting a model to measured data); "
        "use symbolic_math instead for a clean exact/closed-form answer."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "operation": {"type": "string", "enum": sorted(_OPERATIONS)},
            "matrix": {
                "type": "string",
                "description": (
                    "For solve_linear_system/eigenvalues_numeric: the matrix A, in SymPy's own "
                    "literal syntax, e.g. 'Matrix([[3, 1], [1, 2]])'. Numeric entries only."
                ),
            },
            "vector": {
                "type": "string",
                "description": "For solve_linear_system: the right-hand side b, comma-separated, e.g. '9, 8'.",
            },
            "expression": {
                "type": "string",
                "description": (
                    "root_find: a function of `variable`, e.g. 'x^3 - x - 2'. integrate_ode: the "
                    "right-hand side(s) of dy/dt = f(t, y), one per state variable separated by "
                    "commas, e.g. '-0.5*y' or 'v, -9.8' for a system with state_variables='x, v'. "
                    "curve_fit: the model as a function of `variable` and `parameters`, e.g. "
                    "'a*exp(b*x) + c'."
                ),
            },
            "variable": {
                "type": "string",
                "description": "Independent variable name for root_find/curve_fit.",
                "default": "x",
            },
            "state_variables": {
                "type": "string",
                "description": "integrate_ode: comma-separated dependent-variable name(s), e.g. 'y' or 'x, v'.",
                "default": "y",
            },
            "initial_conditions": {
                "type": "string",
                "description": "integrate_ode: comma-separated initial value(s), one per state variable, e.g. '1' or '0, 5'.",
            },
            "t_span": {
                "type": "string",
                "description": "integrate_ode: 'start, end', e.g. '0, 10'.",
            },
            "parameters": {
                "type": "string",
                "description": "curve_fit: comma-separated names of the fit parameters appearing in `expression`, e.g. 'a, b, c'.",
            },
            "initial_guess": {
                "type": "string",
                "description": (
                    "root_find (fsolve): a single number. curve_fit: comma-separated starting "
                    "values, one per parameter (defaults to all 1s if omitted)."
                ),
            },
            "bracket": {
                "type": "string",
                "description": "root_find (brentq): 'low, high' -- an interval where the function changes sign.",
            },
            "x_data": {
                "type": "string",
                "description": "curve_fit: comma-separated x values.",
            },
            "y_data": {
                "type": "string",
                "description": "curve_fit: comma-separated y values, matching x_data.",
            },
        },
        "required": ["operation"],
    }

    async def run(
        self,
        operation: str,
        matrix: str = "",
        vector: str = "",
        expression: str = "",
        variable: str = "x",
        state_variables: str = "y",
        initial_conditions: str = "",
        t_span: str = "",
        parameters: str = "",
        initial_guess: str = "",
        bracket: str = "",
        x_data: str = "",
        y_data: str = "",
    ) -> str:
        try:
            return solve_numeric(
                operation,
                matrix or "",
                vector or "",
                expression or "",
                variable or "x",
                state_variables or "y",
                initial_conditions or "",
                t_span or "",
                parameters or "",
                initial_guess or "",
                bracket or "",
                x_data or "",
                y_data or "",
            )
        except Exception as exc:
            return f"Error: {exc}"
