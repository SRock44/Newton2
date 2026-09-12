import pytest

from app.tools.unit_converter import UnitConverterTool, convert


def test_length_conversion():
    assert convert(1, "mi", "km") == pytest.approx(1.609344)


def test_mass_conversion():
    assert convert(1, "kg", "lb") == pytest.approx(2.2046226, rel=1e-5)


def test_volume_conversion():
    assert convert(1, "gal", "l") == pytest.approx(3.785411784)


def test_temperature_conversion_f_to_c():
    assert convert(212, "f", "c") == pytest.approx(100.0)


def test_temperature_conversion_c_to_k():
    assert convert(0, "c", "k") == pytest.approx(273.15)


def test_same_unit_is_identity():
    assert convert(42, "km", "km") == pytest.approx(42)


def test_rejects_mismatched_dimensions():
    with pytest.raises(ValueError):
        convert(5, "kg", "m")


def test_rejects_mixing_temperature_with_other_dimensions():
    with pytest.raises(ValueError):
        convert(5, "c", "km")


def test_case_and_whitespace_insensitive():
    assert convert(1, " KM ", "M") == pytest.approx(1000)


async def test_unit_converter_tool_run_returns_string_result():
    tool = UnitConverterTool()
    result = await tool.run(value=100, from_unit="cm", to_unit="m")
    assert result == "1.0 m"


async def test_unit_converter_tool_run_returns_error_string_not_exception():
    tool = UnitConverterTool()
    result = await tool.run(value=5, from_unit="kg", to_unit="m")
    assert result.startswith("Error:")
