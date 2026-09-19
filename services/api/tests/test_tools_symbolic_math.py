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


# --- Linear algebra -------------------------------------------------------------
# Every expected value below is hand-computed, not just "the tool's own answer":
#   Matrix([[2, 1], [1, 2]]) -- determinant = 2*2 - 1*1 = 3.
#   Characteristic polynomial: (2-L)^2 - 1 = L^2 - 4L + 3 = (L-1)(L-3) -> eigenvalues 1, 3.
#   Matrix([[2, 1], [1, 1]]) -- determinant = 2*1 - 1*1 = 1, so inverse is
#   (1/1) * [[1, -1], [-1, 2]] = [[1, -1], [-1, 2]] (by the standard 2x2 inverse formula).
#   Matrix([[1, 2], [2, 4]]) is singular (det = 1*4 - 2*2 = 0) and row-reduces to
#   [[1, 2], [0, 0]] (rref), with null space spanned by [-2, 1]: A @ [-2, 1]^T =
#   [1*-2 + 2*1, 2*-2 + 4*1] = [0, 0], confirmed by hand.


def test_determinant_of_2x2_matrix():
    result = solve_math("determinant", "Matrix([[2, 1], [1, 2]])")
    assert result == "3"


def test_determinant_matches_hand_computation_for_larger_matrix():
    # det([[1,2,3],[0,1,4],[5,6,0]]) by cofactor expansion along the first column:
    # 1*(1*0 - 4*6) - 0*(...) + 5*(2*4 - 3*1) = 1*(-24) + 5*(5) = -24 + 25 = 1
    result = solve_math("determinant", "Matrix([[1, 2, 3], [0, 1, 4], [5, 6, 0]])")
    assert result == "1"


def test_eigenvalues_of_symmetric_2x2_matrix():
    result = solve_math("eigenvalues", "Matrix([[2, 1], [1, 2]])")
    # hand-verified: characteristic polynomial L^2 - 4L + 3 = (L-1)(L-3) -> roots 1, 3
    assert "lambda**2 - 4*lambda + 3" in result
    assert "1 (multiplicity 1)" in result
    assert "3 (multiplicity 1)" in result


def test_inverse_of_invertible_matrix():
    result = solve_math("inverse", "Matrix([[2, 1], [1, 1]])")
    assert result == "Matrix([[1, -1], [-1, 2]])"


def test_inverse_of_singular_matrix_raises_clear_error():
    with pytest.raises(ValueError, match="singular"):
        solve_math("inverse", "Matrix([[1, 2], [2, 4]])")


def test_rref_of_singular_matrix():
    result = solve_math("rref", "Matrix([[1, 2], [2, 4]])")
    assert "Matrix([[1, 2], [0, 0]])" in result
    assert "(0,)" in result  # only column 0 is a pivot column


def test_null_space_of_singular_matrix_is_a_real_kernel_vector():
    result = solve_math("null_space", "Matrix([[1, 2], [2, 4]])")
    assert "[-2, 1]" in result
    # verify by hand, via real matrix multiplication, that A @ v == 0
    import sympy

    a = sympy.Matrix([[1, 2], [2, 4]])
    v = sympy.Matrix([-2, 1])
    assert (a * v).is_zero_matrix


def test_matrix_operation_on_non_matrix_expression_raises():
    with pytest.raises(ValueError, match="not a matrix"):
        solve_math("determinant", "x + 1")


def test_matrix_syntax_is_parsed_by_the_existing_safe_parser():
    # Confirms _parse's existing sympify-based parsing (not a new/second eval path)
    # already understands SymPy's own Matrix([[...]]) literal syntax.
    from app.tools.symbolic_math import _parse
    import sympy

    parsed = _parse("Matrix([[1, 2], [3, 4]])")
    assert isinstance(parsed, sympy.MatrixBase)
    assert parsed.det() == -2
