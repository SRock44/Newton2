from typing import Any

from app.tools.base import Tool

# Multiplicative units: value_in_base_unit = value * factor. Grouped by dimension so we
# only ever convert within one dimension (never let "5 kg to meters" silently succeed).
_LENGTH_M = {"m": 1.0, "km": 1000.0, "cm": 0.01, "mm": 0.001, "mi": 1609.344, "ft": 0.3048, "in": 0.0254, "yd": 0.9144}
_MASS_KG = {"kg": 1.0, "g": 0.001, "mg": 1e-6, "lb": 0.45359237, "oz": 0.028349523125}
_VOLUME_L = {"l": 1.0, "ml": 0.001, "gal": 3.785411784, "qt": 0.946352946, "cup": 0.2365882365}

_DIMENSIONS = {"length": _LENGTH_M, "mass": _MASS_KG, "volume": _VOLUME_L}


def _convert_multiplicative(value: float, from_unit: str, to_unit: str) -> float:
    for table in _DIMENSIONS.values():
        if from_unit in table and to_unit in table:
            return value * table[from_unit] / table[to_unit]
    raise ValueError(f"'{from_unit}' and '{to_unit}' aren't both known units of the same kind")


def _to_celsius(value: float, unit: str) -> float:
    if unit == "c":
        return value
    if unit == "f":
        return (value - 32) * 5 / 9
    if unit == "k":
        return value - 273.15
    raise ValueError(f"unknown temperature unit '{unit}'")


def _from_celsius(value_c: float, unit: str) -> float:
    if unit == "c":
        return value_c
    if unit == "f":
        return value_c * 9 / 5 + 32
    if unit == "k":
        return value_c + 273.15
    raise ValueError(f"unknown temperature unit '{unit}'")


_TEMP_UNITS = {"c", "f", "k"}


def convert(value: float, from_unit: str, to_unit: str) -> float:
    from_unit, to_unit = from_unit.strip().lower(), to_unit.strip().lower()
    if from_unit in _TEMP_UNITS or to_unit in _TEMP_UNITS:
        if from_unit not in _TEMP_UNITS or to_unit not in _TEMP_UNITS:
            raise ValueError(f"can't convert between temperature and non-temperature units ({from_unit} -> {to_unit})")
        return _from_celsius(_to_celsius(value, from_unit), to_unit)
    return _convert_multiplicative(value, from_unit, to_unit)


class UnitConverterTool(Tool):
    name = "unit_converter"
    description = (
        "Convert a numeric value between units of the same kind: length (m, km, cm, mm, mi, ft, "
        "in, yd), mass (kg, g, mg, lb, oz), volume (l, ml, gal, qt, cup), or temperature (c, f, k)."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "value": {"type": "number"},
            "from_unit": {"type": "string", "description": "e.g. 'mi', 'kg', 'f'"},
            "to_unit": {"type": "string", "description": "e.g. 'km', 'lb', 'c'"},
        },
        "required": ["value", "from_unit", "to_unit"],
    }

    async def run(self, value: float, from_unit: str, to_unit: str) -> str:
        try:
            result = convert(float(value), from_unit, to_unit)
        except Exception as exc:
            return f"Error: {exc}"
        return f"{result} {to_unit}"
