"""Real numeric verification -- every assertion here is against a hand-checkable or
analytically-known value, since the entire point of numeric_methods is that its
answers are computed by numpy/scipy, not guessed."""

import math

import pytest

from app.tools.numeric_methods import (
    NumericMethodsTool,
    curve_fit_data,
    eigenvalues_numeric,
    integrate_ode,
    root_find,
    solve_linear_system,
    solve_numeric,
)
from app.tools.symbolic_math import _parse

# ---------------------------------------------------------------------------
# solve_linear_system
# ---------------------------------------------------------------------------


def test_solve_linear_system_known_answer():
    # 3x + y = 9, x + 2y = 8 -> x=2, y=3.
    r = solve_linear_system("Matrix([[3, 1], [1, 2]])", "9, 8")
    assert r["x"][0] == pytest.approx(2.0)
    assert r["x"][1] == pytest.approx(3.0)
    assert not r["ill_conditioned"]
    assert not r["severely_ill_conditioned"]


def test_solve_linear_system_ill_conditioned_warning_actually_fires():
    # A 5x5 Hilbert matrix: a textbook ill-conditioned system (cond ~ 4.8e5).
    hilbert5 = "Matrix([[1, 1/2, 1/3, 1/4, 1/5], [1/2, 1/3, 1/4, 1/5, 1/6], " \
        "[1/3, 1/4, 1/5, 1/6, 1/7], [1/4, 1/5, 1/6, 1/7, 1/8], [1/5, 1/6, 1/7, 1/8, 1/9]])"
    r = solve_linear_system(hilbert5, "1, 1, 1, 1, 1")
    assert r["cond"] > 1e4
    assert r["ill_conditioned"] is True

    # And the honest warning text actually appears in the formatted, tutor-facing output.
    text = solve_numeric("solve_linear_system", matrix=hilbert5, vector="1, 1, 1, 1, 1")
    assert "WARNING" in text
    assert "ill-conditioned" in text


def test_solve_linear_system_non_square_is_a_clear_error_not_a_guess():
    with pytest.raises(ValueError, match="square"):
        solve_numeric("solve_linear_system", matrix="Matrix([[1, 2, 3], [4, 5, 6]])", vector="1, 2")


def test_solve_linear_system_singular_matrix_is_honest():
    with pytest.raises(ValueError, match="singular"):
        solve_numeric("solve_linear_system", matrix="Matrix([[1, 2], [2, 4]])", vector="1, 2")


async def test_tool_run_wraps_errors_as_a_clean_string_not_a_raised_exception():
    tool = NumericMethodsTool()
    result = await tool.run(operation="solve_linear_system", matrix="Matrix([[1, 2], [2, 4]])", vector="1, 2")
    assert result.startswith("Error:")
    assert "singular" in result


# ---------------------------------------------------------------------------
# eigenvalues_numeric
# ---------------------------------------------------------------------------


def test_eigenvalues_numeric_known_matrix():
    # [[2, 0], [0, 3]] has eigenvalues 2 and 3 exactly.
    r = eigenvalues_numeric("Matrix([[2, 0], [0, 3]])")
    values = sorted(v.real for v in r["eigenvalues"])
    assert values == pytest.approx([2.0, 3.0])


def test_eigenvalues_numeric_non_symmetric_matrix_with_complex_eigenvalues():
    # A pure rotation-like matrix [[0, -1], [1, 0]] has eigenvalues +-i.
    r = eigenvalues_numeric("Matrix([[0, -1], [1, 0]])")
    reals = sorted(v.real for v in r["eigenvalues"])
    imags = sorted(abs(v.imag) for v in r["eigenvalues"])
    assert reals == pytest.approx([0.0, 0.0], abs=1e-9)
    assert imags == pytest.approx([1.0, 1.0])


def test_eigenvalues_numeric_non_square_raises():
    with pytest.raises(ValueError, match="square"):
        eigenvalues_numeric("Matrix([[1, 2, 3], [4, 5, 6]])")


# ---------------------------------------------------------------------------
# root_find -- and a direct check that symbolic_math's parser is really being reused.
# ---------------------------------------------------------------------------


def test_symbolic_math_parser_reuse_actually_works_end_to_end():
    """Not assumed: parse a string with symbolic_math's own `_parse`, lambdify it, and
    feed the callable to a real scipy solver."""
    import sympy

    expr = _parse("x^3 - x - 2")
    f = sympy.lambdify(sympy.Symbol("x"), expr, modules=["numpy"])
    import scipy.optimize

    root = scipy.optimize.brentq(f, 1, 2)
    assert root == pytest.approx(1.5213797068, abs=1e-8)


def test_root_find_brentq_known_root():
    r = root_find("x^3 - x - 2", bracket="1, 2")
    assert r["root"] == pytest.approx(1.5213797068, abs=1e-8)
    assert abs(r["residual"]) < 1e-8


def test_root_find_fsolve_known_root():
    # cos(x) = x -- the classic fixed point, root ~ 0.7390851332.
    r = root_find("cos(x) - x", initial_guess="0.5")
    assert r["root"] == pytest.approx(0.7390851332, abs=1e-6)


def test_root_find_bracket_without_sign_change_is_honest():
    with pytest.raises(ValueError, match="same sign"):
        root_find("x^2 + 1", bracket="0, 1")


def test_root_find_needs_bracket_or_initial_guess():
    with pytest.raises(ValueError, match="bracket.*initial_guess|initial_guess.*bracket"):
        root_find("x^2 - 4")


# ---------------------------------------------------------------------------
# integrate_ode -- exponential decay has a known analytical solution.
# ---------------------------------------------------------------------------


def test_integrate_ode_exponential_decay_matches_analytical_solution():
    # dy/dt = -0.5 y, y(0) = 1 -> y(t) = exp(-0.5 t); y(10) = exp(-5).
    r = integrate_ode("-0.5*y", state_variables="y", initial_conditions="1", t_span="0, 10")
    analytical = math.exp(-5.0)
    assert r["y_final"][0] == pytest.approx(analytical, rel=1e-4)


def test_integrate_ode_system_matches_analytical_solution():
    # Simple harmonic oscillator dx/dt = v, dv/dt = -x, x(0)=1, v(0)=0 -> x(t) = cos(t).
    r = integrate_ode("v, -x", state_variables="x, v", initial_conditions="1, 0", t_span="0, 3.14159265358979")
    assert r["y_final"][0] == pytest.approx(math.cos(math.pi), abs=1e-4)


def test_integrate_ode_rejects_absurdly_long_span():
    with pytest.raises(ValueError, match="unreasonably|far longer|bounded"):
        integrate_ode("-0.5*y", initial_conditions="1", t_span="0, 1e9")


def test_integrate_ode_mismatched_state_variables_and_rhs_is_honest():
    with pytest.raises(ValueError, match="state variable"):
        integrate_ode("v, -x", state_variables="x", initial_conditions="1", t_span="0, 1")


# ---------------------------------------------------------------------------
# curve_fit
# ---------------------------------------------------------------------------


def test_curve_fit_recovers_known_true_parameters():
    # y = 2 * exp(0.3 x) + 1, sampled exactly (no noise) -- curve_fit should recover
    # a=2, b=0.3, c=1 almost exactly, and R^2 should be ~1.
    xs = [0, 1, 2, 3, 4, 5]
    ys = [2 * math.exp(0.3 * x) + 1 for x in xs]
    r = curve_fit_data(
        "a*exp(b*x) + c",
        x_data=", ".join(str(x) for x in xs),
        y_data=", ".join(str(y) for y in ys),
        parameters="a, b, c",
        initial_guess="1, 1, 1",
    )
    values = dict(zip(r["param_names"], r["popt"]))
    assert values["a"] == pytest.approx(2.0, abs=1e-3)
    assert values["b"] == pytest.approx(0.3, abs=1e-3)
    assert values["c"] == pytest.approx(1.0, abs=1e-3)
    assert r["r_squared"] == pytest.approx(1.0, abs=1e-6)


def test_curve_fit_underdetermined_is_honest():
    with pytest.raises(ValueError, match="underdetermined"):
        curve_fit_data("a*x + b*x**2 + c*x**3", x_data="1, 2", y_data="1, 2", parameters="a, b, c")


# ---------------------------------------------------------------------------
# The tutor-facing Tool wrapper
# ---------------------------------------------------------------------------


async def test_tool_run_solve_linear_system():
    tool = NumericMethodsTool()
    result = await tool.run(operation="solve_linear_system", matrix="Matrix([[3, 1], [1, 2]])", vector="9, 8")
    assert "x1 = 2" in result
    assert "x2 = 3" in result


async def test_tool_run_bad_operation_is_a_clean_error_not_an_exception():
    tool = NumericMethodsTool()
    result = await tool.run(operation="not_a_real_operation")
    assert result.startswith("Error:")
