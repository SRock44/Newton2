from app.tools.check_work import CheckStudentWorkTool


async def test_correct_math_answer_recognized_as_correct():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Solve 2x + 4 = 0 for x.",
        student_work="2x = -4\nx = -2",
    )
    assert result.startswith("CORRECT")
    assert "-2" in result


async def test_incorrect_math_answer_identifies_the_error():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Solve 2x + 4 = 0 for x.",
        student_work="2x = -4\nx = 2",
    )
    assert result.startswith("INCORRECT")
    # the real, verified answer must actually be present, not just an assertion of wrongness
    assert "-2" in result
    # and the student's own (wrong) stated answer is quoted back so the model can point at it
    assert "'2'" in result


async def test_correct_differentiation_recognized():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Differentiate 3x^2 + 2x with respect to x.",
        student_work="d/dx(3x^2) = 6x\nd/dx(2x) = 2\nFinal answer = 6x + 2",
    )
    assert result.startswith("CORRECT")


async def test_non_math_conceptual_problem_gets_verification_prompt_not_a_math_verdict():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Explain why the French Revolution began in 1789.",
        student_work="Because the king was mean and people were hungry.",
    )
    assert not result.startswith("CORRECT")
    assert not result.startswith("INCORRECT")
    assert "conceptual" in result.lower()
    assert "Partially correct" in result  # instructs the model on the verdict categories to use
    assert "Because the king was mean" in result  # student's actual work is included for context


async def test_empty_problem_is_a_clear_error():
    tool = CheckStudentWorkTool()
    result = await tool.run(problem="   ", student_work="x = 2")
    assert result.startswith("Error:")


async def test_empty_student_work_is_a_clear_error():
    tool = CheckStudentWorkTool()
    result = await tool.run(problem="Solve x = 2", student_work="")
    assert result.startswith("Error:")


async def test_registered_with_name_and_required_params():
    tool = CheckStudentWorkTool()
    assert tool.name == "check_student_work"
    assert set(tool.parameters["required"]) == {"problem", "student_work"}


# --- Linear algebra ---------------------------------------------------------------
# Matrix([[2, 1], [1, 2]]): determinant = 2*2 - 1*1 = 3 (hand-verified).
# Matrix([[1, 2], [2, 4]]): singular (det = 0), rref = [[1, 2], [0, 0]], and
# [-2, 1] is a real null-space vector: A @ [-2, 1]^T = [-2+2, -4+4] = [0, 0].


async def test_correct_determinant_recognized_as_correct():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Find the determinant of Matrix([[2, 1], [1, 2]]).",
        student_work="det = (2)(2) - (1)(1) = 3",
    )
    assert result.startswith("CORRECT")
    assert "3" in result


async def test_incorrect_determinant_identifies_the_error():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Find the determinant of Matrix([[2, 1], [1, 2]]).",
        student_work="det = (2)(2) + (1)(1) = 5",
    )
    assert result.startswith("INCORRECT")
    assert "3" in result  # the real answer is stated
    assert "'5'" in result  # the student's own wrong answer is quoted back


async def test_correct_eigenvalues_recognized_and_shows_characteristic_polynomial():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Find the eigenvalues of Matrix([[2, 1], [1, 2]]).",
        student_work="characteristic polynomial: lambda^2 - 4*lambda + 3 = 0\neigenvalues = 1, 3",
    )
    assert result.startswith("CORRECT")
    assert "lambda**2 - 4*lambda + 3" in result  # real work shown, not just the final numbers


async def test_incorrect_eigenvalues_identifies_the_error():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Find the eigenvalues of Matrix([[2, 1], [1, 2]]).",
        student_work="eigenvalues = 1, 4",
    )
    assert result.startswith("INCORRECT")
    assert "'1, 4'" in result


async def test_correct_inverse_recognized():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Find the inverse of Matrix([[2, 1], [1, 1]]).",
        student_work="inverse = Matrix([[1, -1], [-1, 2]])",
    )
    assert result.startswith("CORRECT")


async def test_incorrect_inverse_identifies_the_error():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Find the inverse of Matrix([[2, 1], [1, 1]]).",
        student_work="inverse = Matrix([[1, 1], [-1, 2]])",
    )
    assert result.startswith("INCORRECT")


async def test_correct_rref_recognized():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Find the reduced row echelon form of Matrix([[1, 2], [2, 4]]).",
        student_work="rref = Matrix([[1, 2], [0, 0]])",
    )
    assert result.startswith("CORRECT")


async def test_incorrect_rref_identifies_the_error():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Find the reduced row echelon form of Matrix([[1, 2], [2, 4]]).",
        student_work="rref = Matrix([[1, 0], [0, 1]])",
    )
    assert result.startswith("INCORRECT")


async def test_correct_null_space_vector_recognized_even_if_not_the_displayed_basis_vector():
    tool = CheckStudentWorkTool()
    # A different, but still mathematically valid, nonzero scalar multiple of the
    # basis vector solve_math would display -- a real Av=0 check (not exact string
    # match against a single arbitrary basis choice) must still accept this.
    result = await tool.run(
        problem="Find the null space of Matrix([[1, 2], [2, 4]]).",
        student_work="v = [2, -1]",
    )
    assert result.startswith("CORRECT")


async def test_incorrect_null_space_vector_identifies_the_error():
    tool = CheckStudentWorkTool()
    result = await tool.run(
        problem="Find the null space of Matrix([[1, 2], [2, 4]]).",
        student_work="v = [1, 1]",
    )
    assert result.startswith("INCORRECT")
    assert "A*v = 0" in result  # explains WHY it's wrong, not just "incorrect"
