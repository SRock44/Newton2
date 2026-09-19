from typing import Any

from app.tools.base import Tool

# Multiplicative units: value_in_base_unit = value * factor. Grouped by dimension so we
# only ever convert within one dimension (never let "5 kg to meters" silently succeed).
_LENGTH_M = {"m": 1.0, "km": 1000.0, "cm": 0.01, "mm": 0.001, "mi": 1609.344, "ft": 0.3048, "in": 0.0254, "yd": 0.9144}
_MASS_KG = {"kg": 1.0, "g": 0.001, "mg": 1e-6, "lb": 0.45359237, "oz": 0.028349523125}
_VOLUME_L = {"l": 1.0, "ml": 0.001, "gal": 3.785411784, "qt": 0.946352946, "cup": 0.2365882365}

# Science dimensions (chemistry/physics problems, not recipes). Same shape as above:
# value_in_base_unit = value * factor, and still never convertible across dimensions.
_AMOUNT_MOL = {"mol": 1.0, "mmol": 0.001, "umol": 1e-6, "nmol": 1e-9, "kmol": 1000.0}
# eV uses the exact SI-2019 elementary charge; cal is the thermochemical calorie. keV/
# MeV and MPa/mPa are deliberately absent: their SI prefixes are only distinguishable by
# case, and this converter is case-insensitive, so including them would make a silently
# 10^9-wrong answer possible.
_ENERGY_J = {"j": 1.0, "kj": 1000.0, "cal": 4.184, "kcal": 4184.0, "ev": 1.602176634e-19,
             "wh": 3600.0, "kwh": 3.6e6}
# Molar energy is its OWN dimension, not a member of the energy table -- a bond
# enthalpy in kJ/mol is not a quantity of joules, and letting "500 J -> kJ/mol"
# silently succeed would be exactly the class of mistake this file exists to prevent.
# (Bridging the two needs Avogadro's number, which is a calculation, not a conversion.)
_MOLAR_ENERGY_J_PER_MOL = {"j/mol": 1.0, "kj/mol": 1000.0, "cal/mol": 4.184, "kcal/mol": 4184.0}
# Chemistry convention: 760 torr = 760 mmHg = 1 atm exactly (so 1 atm = 101325 Pa exactly).
_PRESSURE_PA = {"pa": 1.0, "kpa": 1000.0, "hpa": 100.0, "atm": 101325.0, "bar": 100000.0,
                "mbar": 100.0, "torr": 101325.0 / 760.0, "mmhg": 101325.0 / 760.0, "psi": 6894.757293168361}
_CONCENTRATION_MOL_PER_L = {"mol/l": 1.0, "mmol/l": 0.001, "umol/l": 1e-6, "nmol/l": 1e-9, "mol/m^3": 0.001}

_DIMENSIONS = {
    "length": _LENGTH_M,
    "mass": _MASS_KG,
    "volume": _VOLUME_L,
    "amount": _AMOUNT_MOL,
    "energy": _ENERGY_J,
    "molar_energy": _MOLAR_ENERGY_J_PER_MOL,
    "pressure": _PRESSURE_PA,
    "concentration": _CONCENTRATION_MOL_PER_L,
}

# Molarity's conventional shorthand collides with length once case is thrown away: "M"
# is molar but "m" is metres, "mM" is millimolar but "mm" is millimetres. "uM"/"nM" have
# no length meaning (this table has no um/nm), so they're unconditionally concentration;
# "M"/"mM" are genuinely ambiguous and are only read as concentration when the OTHER
# unit in the request pins the dimension down -- see _resolve_pair. That keeps
# "1 KM -> M" metres, as it has always been, while making "1 M -> mmol/L" work, and
# keeps "5 m -> mol/L" an error rather than a silently invented answer.
_MOLAR_ONLY_ALIASES = {"uM": "umol/l", "µM": "umol/l", "μM": "umol/l", "nM": "nmol/l"}
_AMBIGUOUS_MOLAR_ALIASES = {"M": "mol/l", "mM": "mmol/l"}
# Everything else is matched case-insensitively, as it always was.
_ALIASES = {
    "molar": "mol/l", "mol/liter": "mol/l", "mol/litre": "mol/l",
    "mmol/liter": "mmol/l", "mol/dm^3": "mol/l", "mol/dm3": "mol/l",
    "mol/m3": "mol/m^3", "joule": "j", "joules": "j", "calorie": "cal", "calories": "cal",
    "mole": "mol", "moles": "mol", "atmosphere": "atm", "atmospheres": "atm", "mm hg": "mmhg",
    "liter": "l", "liters": "l", "litre": "l", "litres": "l", "gram": "g", "grams": "g",
}


def _normalize_unit(unit: str) -> str:
    unit = unit.strip()
    if unit in _MOLAR_ONLY_ALIASES:
        return _MOLAR_ONLY_ALIASES[unit]
    lowered = unit.lower().replace("³", "^3").replace("μ", "u").replace("µ", "u")
    return _ALIASES.get(lowered, lowered)


def _resolve_pair(from_unit: str, to_unit: str) -> tuple[str, str]:
    """Normalize both units together, so an ambiguous "M"/"mM" can be read as molar
    exactly when its partner is unambiguously a concentration."""
    raw_from, raw_to = from_unit.strip(), to_unit.strip()
    a, b = _normalize_unit(raw_from), _normalize_unit(raw_to)
    if raw_from in _AMBIGUOUS_MOLAR_ALIASES and b in _CONCENTRATION_MOL_PER_L:
        a = _AMBIGUOUS_MOLAR_ALIASES[raw_from]
    if raw_to in _AMBIGUOUS_MOLAR_ALIASES and a in _CONCENTRATION_MOL_PER_L:
        b = _AMBIGUOUS_MOLAR_ALIASES[raw_to]
    return a, b


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
    from_unit, to_unit = _resolve_pair(from_unit, to_unit)
    if from_unit in _TEMP_UNITS or to_unit in _TEMP_UNITS:
        if from_unit not in _TEMP_UNITS or to_unit not in _TEMP_UNITS:
            raise ValueError(f"can't convert between temperature and non-temperature units ({from_unit} -> {to_unit})")
        return _from_celsius(_to_celsius(value, from_unit), to_unit)
    return _convert_multiplicative(value, from_unit, to_unit)


class UnitConverterTool(Tool):
    name = "unit_converter"
    description = (
        "Convert a numeric value between units of the same kind: length (m, km, cm, mm, mi, ft, "
        "in, yd), mass (kg, g, mg, lb, oz), volume (l, ml, gal, qt, cup), temperature (c, f, k), "
        "amount of substance (mol, mmol, umol, kmol), energy (J, kJ, cal, kcal, eV, kWh), molar "
        "energy (kJ/mol, kcal/mol), pressure (atm, Pa, kPa, bar, torr, mmHg, psi), or "
        "concentration (M, mol/L, mM, mmol/L, uM). Note 'M' means molar and 'm' means metres."
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
