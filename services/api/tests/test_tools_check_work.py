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
