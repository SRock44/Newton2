import ast
import operator
from typing import Any

from app.tools.base import Tool

_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARYOPS = {ast.USub: operator.neg, ast.UAdd: operator.pos}


def _eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _BINOPS:
        return _BINOPS[type(node.op)](_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARYOPS:
        return _UNARYOPS[type(node.op)](_eval_node(node.operand))
    raise ValueError(f"unsupported expression element: {ast.dump(node)}")


def evaluate(expression: str) -> float:
    """Safely evaluate a numeric expression — literals, + - * / // % **, parentheses,
    unary +/- only. Deliberately not `eval()`: this walks a restricted AST so there is
    no way to reach arbitrary code execution through a model-controlled string."""
    tree = ast.parse(expression, mode="eval")
    return _eval_node(tree.body)


class CalculatorTool(Tool):
    name = "calculator"
    description = (
        "Evaluate an exact arithmetic expression (+, -, *, /, //, %, **, parentheses). "
        "Use this instead of computing arithmetic yourself whenever precision matters."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "expression": {"type": "string", "description": "e.g. '(3 + 4) * 2 / 7'"},
        },
        "required": ["expression"],
    }

    async def run(self, expression: str) -> str:
        try:
            return str(evaluate(expression))
        except Exception as exc:
            return f"Error: could not evaluate '{expression}': {exc}"
