import pytest

from app.tools.symbolic_math import SymbolicMathTool, solve_math


def test_solve_simple_linear_equation():
    result = solve_math("solve", "2*x + 4 = 0", "x")
    assert result == "[-2]"


def test_solve_quadratic_equation_caret_notation():
    # '^' must mean power here, not XOR -- the default SymPy parser gets this wrong.
    result = solve_math("solve", "x^2 - 4 = 0", "x")
    assert result in ("[-2, 2]", "[2, -2]")


def test_implicit_multiplication_is_understood():
    # "3x" should parse as 3*x, not a syntax error.
    result = solve_math("differentiate", "3x^2 + 2x", "x")
    assert result == "6*x + 2"


def test_differentiate_basic_polynomial():
    assert solve_math("differentiate", "x**3", "x") == "3*x**2"


def test_integrate_basic_polynomial():
    assert solve_math("integrate", "2*x", "x") == "x**2"


def test_simplify_trig_identity():
    result = solve_math("simplify", "sin(x)**2 + cos(x)**2", "x")
    assert result == "1"


def test_factor_polynomial():
    result = solve_math("factor", "x**2 - 1", "x")
    assert result == "(x - 1)*(x + 1)"


def test_expand_polynomial():
    result = solve_math("expand", "(x + 1)**2", "x")
    assert result == "x**2 + 2*x + 1"


def test_unknown_operation_raises():
    with pytest.raises(ValueError, match="unknown operation"):
        solve_math("levitate", "x", "x")


def test_unparseable_expression_raises():
    with pytest.raises(ValueError, match="could not parse"):
        solve_math("simplify", "this is not math @#$", "x")


async def test_tool_run_returns_string_result():
    tool = SymbolicMathTool()
    result = await tool.run(operation="solve", expression="x^2 - 9 = 0", variable="x")
    assert result in ("[-3, 3]", "[3, -3]")


async def test_tool_run_returns_error_string_not_exception():
    tool = SymbolicMathTool()
    result = await tool.run(operation="bogus", expression="x")
    assert result.startswith("Error:")
