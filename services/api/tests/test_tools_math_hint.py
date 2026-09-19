from app.tools.math_hint import GetMathHintTool
from app.tools.symbolic_math import solve_math


async def test_level_1_gives_approach_only_and_never_leaks_the_answer():
    tool = GetMathHintTool()
    answer = solve_math("solve", "x^2 - 4 = 0")

    result = await tool.run(operation="solve", expression="x^2 - 4 = 0", hint_level=1)

    assert result.startswith("Hint (level 1")
    # the verified answer ("[-2, 2]") must not appear -- only the restated problem and
    # a generic conceptual nudge, no numbers from the actual solution
    assert answer not in result
    assert "isolates the variable" in result or "roots" in result


async def test_level_2_gives_a_real_grounded_first_step():
    tool = GetMathHintTool()
    result = await tool.run(operation="solve", expression="x^2 - 4 = 0", hint_level=2)

    assert result.startswith("Hint (level 2")
    # grounded in the real rearrangement sympy actually did, not a generic step
    assert "x**2 - 4 = 0" in result


async def test_level_3_matches_the_real_solve_math_result():
    tool = GetMathHintTool()
    answer = solve_math("differentiate", "3x^2 + 2x")

    result = await tool.run(operation="differentiate", expression="3x^2 + 2x", hint_level=3)

    assert result.startswith("Hint (level 3")
    assert answer in result


async def test_all_three_levels_for_the_same_problem_escalate():
    tool = GetMathHintTool()
    levels = [
        await tool.run(operation="factor", expression="x^2 - 1", hint_level=level)
        for level in (1, 2, 3)
    ]
    assert levels[0].startswith("Hint (level 1")
    assert levels[1].startswith("Hint (level 2")
    assert levels[2].startswith("Hint (level 3")
    # level 3 alone actually states the final factored answer
    answer = solve_math("factor", "x^2 - 1")
    assert answer not in levels[0]
    assert answer in levels[2]


async def test_unparseable_expression_returns_clear_error_not_a_crash():
    tool = GetMathHintTool()
    result = await tool.run(operation="simplify", expression="this is not math @#$", hint_level=1)
    assert result.startswith("Error:")


async def test_registered_with_name_and_required_params():
    tool = GetMathHintTool()
    assert tool.name == "get_math_hint"
    assert set(tool.parameters["required"]) == {"operation", "expression", "hint_level"}


# --- Linear algebra ---------------------------------------------------------------


async def test_determinant_level_1_gives_approach_only_and_never_leaks_the_answer():
    tool = GetMathHintTool()
    answer = solve_math("determinant", "Matrix([[2, 1], [1, 2]])")  # "3"

    result = await tool.run(operation="determinant", expression="Matrix([[2, 1], [1, 2]])", hint_level=1)

    assert result.startswith("Hint (level 1")
    assert answer not in result
    assert "cofactor expansion" in result or "row-reduce" in result


async def test_eigenvalues_level_2_gives_the_real_characteristic_matrix():
    tool = GetMathHintTool()
    result = await tool.run(operation="eigenvalues", expression="Matrix([[2, 1], [1, 2]])", hint_level=2)

    assert result.startswith("Hint (level 2")
    # grounded in the real A - lambda*I sympy actually built, not a generic step
    assert "2 - lambda" in result


async def test_eigenvalues_level_3_matches_the_real_solve_math_result():
    tool = GetMathHintTool()
    answer = solve_math("eigenvalues", "Matrix([[2, 1], [1, 2]])")

    result = await tool.run(operation="eigenvalues", expression="Matrix([[2, 1], [1, 2]])", hint_level=3)

    assert result.startswith("Hint (level 3")
    assert answer in result
    assert "lambda**2 - 4*lambda + 3" in result  # characteristic polynomial is shown


async def test_inverse_hint_on_singular_matrix_is_a_clear_error_not_a_crash():
    tool = GetMathHintTool()
    result = await tool.run(operation="inverse", expression="Matrix([[1, 2], [2, 4]])", hint_level=1)
    assert result.startswith("Error:")
    assert "singular" in result


async def test_null_space_level_2_grounds_the_hint_in_the_real_rref():
    tool = GetMathHintTool()
    result = await tool.run(operation="null_space", expression="Matrix([[1, 2], [2, 4]])", hint_level=2)

    assert result.startswith("Hint (level 2")
    assert "Matrix([[1, 2], [0, 0]])" in result  # the real rref, hand-verifiable


async def test_rref_all_three_levels_escalate():
    tool = GetMathHintTool()
    levels = [
        await tool.run(operation="rref", expression="Matrix([[1, 2], [2, 4]])", hint_level=level)
        for level in (1, 2, 3)
    ]
    assert levels[0].startswith("Hint (level 1")
    assert levels[1].startswith("Hint (level 2")
    assert levels[2].startswith("Hint (level 3")
    answer = solve_math("rref", "Matrix([[1, 2], [2, 4]])")
    assert answer not in levels[0]
    assert answer in levels[2]
