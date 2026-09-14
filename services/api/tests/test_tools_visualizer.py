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


# ---------------------------------------------------------------------------
# Learn Mode's manipulable visualization -- plot_function_spec's optional `vary`
# argument (see app/agents/tutor.py's LEARN_MODE_SYSTEM_ADDENDUM). The single-curve
# path above is completely unchanged (every test above calls it with no `vary` at all,
# and still passes unmodified).
# ---------------------------------------------------------------------------


def test_vary_produces_one_trace_per_discrete_position():
    spec = plot_function_spec(
        "a*x^2", x_min=-2, x_max=2, num_points=5, vary={"symbol": "a", "min": 1, "max": 3, "steps": 3}
    )
    assert len(spec["data"]) == 3
    assert spec["sliders"] == [{"label": "a", "values": [1.0, 2.0, 3.0], "active": 1}]


def test_vary_each_trace_has_the_mathematically_correct_curve():
    spec = plot_function_spec(
        "a*x^2", x_min=-2, x_max=2, num_points=5, vary={"symbol": "a", "min": 1, "max": 3, "steps": 3}
    )
    for trace, a in zip(spec["data"], [1.0, 2.0, 3.0]):
        for x, y in zip(trace["x"], trace["y"]):
            assert y == pytest.approx(a * x**2)


def test_vary_only_the_middle_position_is_initially_visible():
    spec = plot_function_spec(
        "a*x", x_min=-1, x_max=1, num_points=3, vary={"symbol": "a", "min": 0, "max": 4, "steps": 5}
    )
    visibility = [trace["visible"] for trace in spec["data"]]
    assert visibility == [False, False, True, False, False]
    assert spec["sliders"][0]["active"] == 2


def test_vary_defaults_to_5_steps_when_steps_omitted():
    spec = plot_function_spec("a*x", x_min=-1, x_max=1, num_points=3, vary={"symbol": "a", "min": 0, "max": 4})
    assert len(spec["data"]) == 5


def test_vary_rejects_steps_outside_2_to_11():
    with pytest.raises(ValueError, match="vary.steps"):
        plot_function_spec("a*x", vary={"symbol": "a", "min": 0, "max": 1, "steps": 1})
    with pytest.raises(ValueError, match="vary.steps"):
        plot_function_spec("a*x", vary={"symbol": "a", "min": 0, "max": 1, "steps": 12})


def test_vary_rejects_max_not_greater_than_min():
    with pytest.raises(ValueError, match="vary.max"):
        plot_function_spec("a*x", vary={"symbol": "a", "min": 5, "max": 5, "steps": 3})


def test_vary_rejects_symbol_matching_the_plot_variable():
    with pytest.raises(ValueError, match="must differ"):
        plot_function_spec("x*x", vary={"symbol": "x", "min": 0, "max": 1, "steps": 3})


def test_vary_rejects_a_third_unexpected_symbol():
    with pytest.raises(ValueError, match="unexpected variable"):
        plot_function_spec("a*x + b", vary={"symbol": "a", "min": 0, "max": 1, "steps": 3})


def test_vary_expression_may_omit_the_vary_symbol_and_still_work():
    # Every position produces the same (parameter-free) curve -- degenerate but valid.
    spec = plot_function_spec("x^2", x_min=-1, x_max=1, num_points=3, vary={"symbol": "a", "min": 0, "max": 1, "steps": 2})
    assert len(spec["data"]) == 2
    assert spec["data"][0]["y"] == spec["data"][1]["y"]


def test_vary_layout_and_type_match_the_single_curve_shape():
    spec = plot_function_spec("a*x", vary={"symbol": "a", "min": 0, "max": 1, "steps": 2})
    assert spec["type"] == "plotly_figure"
    assert spec["layout"]["xaxis"]["title"] == "x"


async def test_tool_run_passes_vary_through_to_a_slider_enabled_spec():
    tool = VisualizerTool()
    result = await tool.run(expression="a*x^2", x_min=-2, x_max=2, vary={"symbol": "a", "min": 1, "max": 3, "steps": 3})
    payload = result.removeprefix("```plotly-figure\n").removesuffix("\n```")
    parsed = json.loads(payload)
    assert len(parsed["data"]) == 3
    assert parsed["sliders"][0]["label"] == "a"


async def test_tool_run_with_no_vary_matches_pre_existing_single_curve_shape():
    """Backward compatibility: calling the tool exactly as before (no `vary` at all)
    must produce the same single-trace, no-`sliders` shape it always has."""
    tool = VisualizerTool()
    result = await tool.run(expression="x^2", x_min=-1, x_max=1)
    payload = result.removeprefix("```plotly-figure\n").removesuffix("\n```")
    parsed = json.loads(payload)
    assert len(parsed["data"]) == 1
    assert "sliders" not in parsed
