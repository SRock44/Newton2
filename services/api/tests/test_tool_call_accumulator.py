import pytest

from app.providers.tool_call_accumulator import ToolCallAccumulator


def test_single_call_split_across_many_argument_fragments():
    """Mirrors real Groq/OpenAI SSE behavior: the first delta carries id+name (and often
    an empty arguments string), every delta carries a fragment of the arguments JSON to
    concatenate in order."""
    acc = ToolCallAccumulator()
    acc.add_delta([{"index": 0, "id": "call_1", "type": "function", "function": {"name": "calculator", "arguments": ""}}])
    acc.add_delta([{"index": 0, "function": {"arguments": '{"expression"'}}])
    acc.add_delta([{"index": 0, "function": {"arguments": ': "3 + 4"'}}])
    acc.add_delta([{"index": 0, "function": {"arguments": "}"}}])

    calls = acc.finalize()
    assert len(calls) == 1
    assert calls[0].id == "call_1"
    assert calls[0].name == "calculator"
    assert calls[0].arguments == {"expression": "3 + 4"}


def test_two_parallel_calls_interleaved_by_index():
    acc = ToolCallAccumulator()
    acc.add_delta(
        [
            {"index": 0, "id": "call_a", "function": {"name": "calculator", "arguments": ""}},
            {"index": 1, "id": "call_b", "function": {"name": "unit_converter", "arguments": ""}},
        ]
    )
    acc.add_delta([{"index": 1, "function": {"arguments": '{"value": 1, '}}])
    acc.add_delta([{"index": 0, "function": {"arguments": '{"expression": "1+1"}'}}])
    acc.add_delta([{"index": 1, "function": {"arguments": '"from_unit": "mi", "to_unit": "km"}'}}])

    calls = acc.finalize()
    assert len(calls) == 2
    by_name = {c.name: c for c in calls}
    assert by_name["calculator"].arguments == {"expression": "1+1"}
    assert by_name["unit_converter"].arguments == {"value": 1, "from_unit": "mi", "to_unit": "km"}


def test_empty_arguments_finalizes_to_empty_dict():
    acc = ToolCallAccumulator()
    acc.add_delta([{"index": 0, "id": "call_1", "function": {"name": "no_args_tool"}}])
    calls = acc.finalize()
    assert calls[0].arguments == {}


def test_is_empty_true_when_nothing_added():
    assert ToolCallAccumulator().is_empty() is True


def test_finalize_raises_on_invalid_json_arguments():
    acc = ToolCallAccumulator()
    acc.add_delta([{"index": 0, "id": "call_1", "function": {"name": "calculator", "arguments": "{not valid json"}}])
    with pytest.raises(ValueError, match="valid JSON"):
        acc.finalize()


def test_finalize_raises_when_name_never_arrives():
    acc = ToolCallAccumulator()
    acc.add_delta([{"index": 0, "id": "call_1", "function": {"arguments": "{}"}}])
    with pytest.raises(ValueError, match="function name"):
        acc.finalize()
