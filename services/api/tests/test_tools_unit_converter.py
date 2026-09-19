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


# ---------------------------------------------------------------------------
# Science dimensions -- every factor below is a defined/exact conversion, so these
# assert the real numbers rather than a tolerance band around a remembered one.
# ---------------------------------------------------------------------------


def test_one_atm_is_exactly_101325_pascal():
    assert convert(1, "atm", "Pa") == 101325.0


def test_760_torr_is_one_atm():
    assert convert(760, "torr", "atm") == pytest.approx(1.0)


def test_760_mmhg_is_one_atm():
    assert convert(760, "mmHg", "atm") == pytest.approx(1.0)


def test_one_bar_is_100_kpa():
    assert convert(1, "bar", "kPa") == pytest.approx(100.0)


def test_moles_to_millimoles():
    assert convert(1, "mol", "mmol") == pytest.approx(1000.0)


def test_micromoles_to_moles():
    assert convert(2500, "umol", "mmol") == pytest.approx(2.5)


def test_kilocalorie_is_4184_joules():
    assert convert(1, "kcal", "J") == pytest.approx(4184.0)


def test_calorie_is_4_point_184_joules():
    assert convert(1, "cal", "J") == pytest.approx(4.184)


def test_electronvolt_in_joules():
    assert convert(1, "eV", "J") == pytest.approx(1.602176634e-19)


def test_kilojoule_to_kilocalorie():
    # 1 kcal = 4.184 kJ, so 4.184 kJ is exactly 1 kcal.
    assert convert(4.184, "kJ", "kcal") == pytest.approx(1.0)


def test_molar_energy_kj_per_mol():
    assert convert(1, "kJ/mol", "J/mol") == pytest.approx(1000.0)


def test_molar_energy_kcal_per_mol_to_kj_per_mol():
    assert convert(1, "kcal/mol", "kJ/mol") == pytest.approx(4.184)


def test_molarity_shorthand_is_moles_per_litre():
    assert convert(1, "M", "mmol/L") == pytest.approx(1000.0)


def test_millimolar_shorthand():
    assert convert(250, "mM", "mol/L") == pytest.approx(0.25)


def test_micromolar_shorthand_is_unambiguous():
    # "uM" has no length meaning, so it reads as concentration with any partner.
    assert convert(1500, "uM", "mmol/L") == pytest.approx(1.5)


def test_concentration_long_form():
    assert convert(0.5, "mol/L", "mmol/L") == pytest.approx(500.0)


def test_capital_m_is_molar_but_lowercase_m_is_still_metres():
    # The one real ambiguity in chemistry unit shorthand -- resolved by looking at the
    # other unit in the pair, so neither meaning quietly shadows the other.
    assert convert(1000, "m", "km") == pytest.approx(1.0)
    assert convert(1, "M", "mol/L") == pytest.approx(1.0)
    assert convert(1000, "mm", "m") == pytest.approx(1.0)
    assert convert(1000, "mM", "mol/L") == pytest.approx(1.0)
    # An all-ambiguous pair keeps the long-standing length reading (and happens to give
    # the same number either way, since the SI prefixes are the same).
    assert convert(1, "M", "mM") == pytest.approx(1000.0)


def test_metres_cannot_become_molarity():
    with pytest.raises(ValueError):
        convert(5, "m", "mol/L")


def test_energy_and_molar_energy_are_separate_dimensions():
    # A bond enthalpy in kJ/mol is not a quantity of joules; bridging them needs
    # Avogadro's number, which is a calculation and not a unit conversion.
    with pytest.raises(ValueError):
        convert(1, "J", "kJ/mol")


def test_pressure_cannot_become_energy():
    with pytest.raises(ValueError):
        convert(1, "atm", "J")


def test_moles_cannot_become_grams():
    # Needs a molar mass -- that's chemistry_solver's job, not a conversion factor.
    with pytest.raises(ValueError):
        convert(1, "mol", "g")


async def test_unit_converter_tool_run_returns_string_result():
    tool = UnitConverterTool()
    result = await tool.run(value=100, from_unit="cm", to_unit="m")
    assert result == "1.0 m"


async def test_unit_converter_tool_run_returns_error_string_not_exception():
    tool = UnitConverterTool()
    result = await tool.run(value=5, from_unit="kg", to_unit="m")
    assert result.startswith("Error:")
