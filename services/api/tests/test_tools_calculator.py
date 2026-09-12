import pytest

from app.tools.calculator import CalculatorTool, evaluate


@pytest.mark.parametrize(
    "expr,expected",
    [
        ("3 + 4", 7),
        ("(3 + 4) * 2", 14),
        ("2 ** 10", 1024),
        ("7 // 2", 3),
        ("7 % 2", 1),
        ("-5 + 2", -3),
        ("10 / 4", 2.5),
    ],
)
def test_evaluate_arithmetic(expr, expected):
    assert evaluate(expr) == expected


@pytest.mark.parametrize(
    "expr",
    [
        "__import__('os').system('echo hi')",
        "open('/etc/passwd')",
        "[x for x in range(10)]",
        "1; 2",
    ],
)
def test_evaluate_rejects_anything_not_a_pure_arithmetic_expression(expr):
    with pytest.raises((ValueError, SyntaxError)):
        evaluate(expr)


async def test_calculator_tool_run_returns_string_result():
    tool = CalculatorTool()
    result = await tool.run(expression="6 * 7")
    assert result == "42"


async def test_calculator_tool_run_returns_error_string_not_exception():
    tool = CalculatorTool()
    result = await tool.run(expression="not an expression")
    assert result.startswith("Error:")
