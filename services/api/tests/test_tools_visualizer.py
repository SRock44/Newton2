import json

import pytest

from app.tools.visualizer import VisualizerTool, plot_function_spec


def test_basic_linear_function_spec_shape():
    spec = plot_function_spec("x", x_min=0, x_max=10, num_points=11)
    assert spec["type"] == "plotly_figure"
    assert len(spec["data"]) == 1
    trace = spec["data"][0]
    assert trace["x"][0] == pytest.approx(0)
    assert trace["x"][-1] == pytest.approx(10)
    assert trace["y"][0] == pytest.approx(0)
    assert trace["y"][-1] == pytest.approx(10)
    assert len(trace["x"]) == len(trace["y"]) == 11


def test_quadratic_values_are_correct():
    spec = plot_function_spec("x^2", x_min=-2, x_max=2, num_points=5)
    xs, ys = spec["data"][0]["x"], spec["data"][0]["y"]
    for x, y in zip(xs, ys):
        assert y == pytest.approx(x**2)


def test_implicit_multiplication_and_caret_in_plot_expression():
    spec = plot_function_spec("2x^2 + 1", x_min=0, x_max=1, num_points=2)
    ys = spec["data"][0]["y"]
    assert ys[0] == pytest.approx(1)  # 2*0^2 + 1
    assert ys[1] == pytest.approx(3)  # 2*1^2 + 1


def test_discontinuity_is_dropped_not_crashed():
    # 1/x is undefined at x=0 -- must not raise, and 0 shouldn't appear as a sampled x
    # when the range straddles it and num_points happens to land exactly on 0.
    spec = plot_function_spec("1/x", x_min=-2, x_max=2, num_points=5)
    xs = spec["data"][0]["x"]
    assert 0 not in xs
    assert len(xs) == 4  # one of the 5 evenly-spaced points (x=0) got dropped


def test_rejects_x_max_not_greater_than_x_min():
    with pytest.raises(ValueError, match="x_max"):
        plot_function_spec("x", x_min=5, x_max=5)


def test_rejects_unparseable_expression():
    with pytest.raises(ValueError, match="could not parse"):
        plot_function_spec("not math @#$", x_min=0, x_max=1)


def test_rejects_unexpected_second_variable():
    with pytest.raises(ValueError, match="unexpected variable"):
        plot_function_spec("x + y", x_min=0, x_max=1)


def test_rejects_num_points_out_of_range():
    with pytest.raises(ValueError, match="num_points"):
        plot_function_spec("x", num_points=1)


async def test_tool_run_wraps_valid_json_in_plotly_fence():
    tool = VisualizerTool()
    result = await tool.run(expression="x^2", x_min=-1, x_max=1)
    assert result.startswith("```plotly-figure\n")
    assert result.endswith("\n```")
    payload = result.removeprefix("```plotly-figure\n").removesuffix("\n```")
    parsed = json.loads(payload)  # must be valid JSON
    assert parsed["type"] == "plotly_figure"


async def test_tool_run_returns_error_string_not_exception():
    tool = VisualizerTool()
    result = await tool.run(expression="x + y", x_min=0, x_max=1)
    assert result.startswith("Error:")
