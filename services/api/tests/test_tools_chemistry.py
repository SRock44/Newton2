"""Every assertion here is against a hand-checkable, textbook-correct value -- the
point of chemistry_solver is that its numbers are computed, so a test that only
proved "it returned something" would prove nothing at all."""

import pytest

from app.tools.chemistry import (
    ChemistrySolverTool,
    balance,
    format_balanced,
    ideal_gas_law,
    molar_mass,
    parse_formula,
    ph_calculation,
    solve_chemistry,
    stoichiometry,
)

# ---------------------------------------------------------------------------
# Formula parsing
# ---------------------------------------------------------------------------


def test_parse_simple_formula():
    assert parse_formula("C3H8") == {"C": 3, "H": 8}


def test_parse_parenthesised_group():
    assert parse_formula("Ca(OH)2") == {"Ca": 1, "O": 2, "H": 2}


def test_parse_nested_multiplier_group():
    # Fe2(SO4)3 is 2 Fe, 3 S and 3*4 = 12 O.
    assert parse_formula("Fe2(SO4)3") == {"Fe": 2, "S": 3, "O": 12}


def test_parse_square_brackets_and_nesting():
    assert parse_formula("K4[Fe(CN)6]") == {"K": 4, "Fe": 1, "C": 6, "N": 6}


def test_parse_hydrate_dot():
    # CuSO4*5H2O: the pentahydrate adds 10 H and 5 O to the 4 O already there.
    assert parse_formula("CuSO4*5H2O") == {"Cu": 1, "S": 1, "O": 9, "H": 10}


def test_two_letter_and_one_letter_symbols_are_distinguished():
    assert parse_formula("NaCl") == {"Na": 1, "Cl": 1}
    assert parse_formula("CO") == {"C": 1, "O": 1}


def test_ionic_charge_is_rejected_not_silently_dropped():
    with pytest.raises(ValueError, match="ionic charges"):
        parse_formula("SO4^2-")


def test_unknown_element_symbol_raises():
    with pytest.raises(ValueError, match="not an element symbol"):
        parse_formula("Xz2")


# ---------------------------------------------------------------------------
# Molar mass -- against the real IUPAC standard atomic weights
# ---------------------------------------------------------------------------


def test_molar_mass_water():
    # 2(1.008) + 15.999 = 18.015
    assert molar_mass("H2O") == pytest.approx(18.015)


def test_molar_mass_propane():
    # 3(12.011) + 8(1.008) = 36.033 + 8.064 = 44.097
    assert molar_mass("C3H8") == pytest.approx(44.097)


def test_molar_mass_carbon_dioxide():
    # 12.011 + 2(15.999) = 44.009
    assert molar_mass("CO2") == pytest.approx(44.009)


def test_molar_mass_iron_iii_sulfate():
    # 2(55.845) + 3(32.06) + 12(15.999) = 111.690 + 96.180 + 191.988 = 399.858
    assert molar_mass("Fe2(SO4)3") == pytest.approx(399.858)


def test_molar_mass_sodium_chloride():
    # 22.98976928 + 35.45 = 58.43976928
    assert molar_mass("NaCl") == pytest.approx(58.43976928)


# ---------------------------------------------------------------------------
# Balancing
# ---------------------------------------------------------------------------


def test_balance_propane_combustion():
    left, right = balance("C3H8 + O2 -> CO2 + H2O")
    assert left == [(1, "C3H8"), (5, "O2")]
    assert right == [(3, "CO2"), (4, "H2O")]


def test_balance_renders_without_a_leading_one():
    assert format_balanced("C3H8 + O2 -> CO2 + H2O") == "C3H8 + 5 O2 -> 3 CO2 + 4 H2O"


def test_balance_rusting_iron():
    assert format_balanced("Fe + O2 -> Fe2O3") == "4 Fe + 3 O2 -> 2 Fe2O3"


def test_balance_ammonia_synthesis():
    assert format_balanced("N2 + H2 -> NH3") == "N2 + 3 H2 -> 2 NH3"


def test_balance_double_replacement_already_one_to_one():
    assert format_balanced("AgNO3 + NaCl -> AgCl + NaNO3") == "AgNO3 + NaCl -> AgCl + NaNO3"


def test_balance_polyatomic_groups():
    assert (
        format_balanced("Ca(OH)2 + H3PO4 -> Ca3(PO4)2 + H2O")
        == "3 Ca(OH)2 + 2 H3PO4 -> Ca3(PO4)2 + 6 H2O"
    )


def test_balance_permanganate_redox():
    # The classic KMnO4/HCl redox, balanced as whole species (no explicit electrons).
    assert (
        format_balanced("KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2")
        == "2 KMnO4 + 16 HCl -> 2 KCl + 2 MnCl2 + 8 H2O + 5 Cl2"
    )


def test_balance_photosynthesis():
    assert format_balanced("CO2 + H2O -> C6H12O6 + O2") == "6 CO2 + 6 H2O -> C6H12O6 + 6 O2"


def test_existing_coefficients_are_recomputed_not_trusted():
    # Given a correct-but-non-minimal balance, we still return the reduced one...
    assert format_balanced("2 C3H8 + 10 O2 -> 6 CO2 + 8 H2O") == "C3H8 + 5 O2 -> 3 CO2 + 4 H2O"


def test_wrong_given_coefficients_are_overridden_and_flagged():
    result = solve_chemistry(
        "stoichiometry", equation="C3H8 + 2 O2 -> CO2 + H2O", given="1 mol C3H8", find="CO2"
    )
    assert "C3H8 + 5 O2 -> 3 CO2 + 4 H2O" in result
    assert "not a correct balance" in result


def test_unbalanceable_equation_raises():
    with pytest.raises(ValueError, match="cannot be balanced"):
        balance("Na -> Cl")


def test_underdetermined_equation_is_reported_not_guessed():
    # C + O2 -> CO + CO2 has a two-dimensional solution space: no single right answer.
    with pytest.raises(ValueError, match="underdetermined"):
        balance("C + O2 -> CO + CO2")


def test_equation_without_an_arrow_raises():
    with pytest.raises(ValueError, match="exactly one arrow"):
        balance("C3H8 + O2 CO2")


def test_alternate_arrow_spellings_work():
    assert format_balanced("N2 + H2 → NH3") == "N2 + 3 H2 -> 2 NH3"
    assert format_balanced("N2 + H2 = NH3") == "N2 + 3 H2 -> 2 NH3"


# ---------------------------------------------------------------------------
# Stoichiometry
# ---------------------------------------------------------------------------


def test_stoichiometry_grams_of_co2_from_22g_propane():
    # Hand-computed: M(C3H8) = 44.097, so 22 g = 22/44.097 = 0.4989002 mol.
    # C3H8 + 5 O2 -> 3 CO2 + 4 H2O, so n(CO2) = 3 * 0.4989002 = 1.4967005 mol.
    # M(CO2) = 44.009, so m(CO2) = 1.4967005 * 44.009 = 65.8683 g.
    r = stoichiometry("C3H8 + O2 -> CO2 + H2O", "22 g C3H8", "CO2")
    assert r["balanced_equation"] == "C3H8 + 5 O2 -> 3 CO2 + 4 H2O"
    assert r["known_moles"] == pytest.approx(0.4989002, rel=1e-6)
    assert r["target_moles"] == pytest.approx(1.4967005, rel=1e-6)
    assert r["target_grams"] == pytest.approx(65.8683, rel=1e-5)


def test_stoichiometry_from_moles_uses_the_plain_mole_ratio():
    # 2 mol C3H8 needs 5x that of O2 = 10 mol exactly.
    r = stoichiometry("C3H8 + O2 -> CO2 + H2O", "2 mol C3H8", "O2")
    assert r["target_moles"] == pytest.approx(10.0)
    # M(O2) = 2(15.999) = 31.998, so 10 mol = 319.98 g.
    assert r["target_grams"] == pytest.approx(319.98)


def test_stoichiometry_water_from_ammonia_synthesis_direction():
    # N2 + 3 H2 -> 2 NH3; 1 mol N2 gives 2 mol NH3 = 2 * 17.031 = 34.062 g.
    # M(NH3) = 14.007 + 3(1.008) = 17.031
    r = stoichiometry("N2 + H2 -> NH3", "1 mol N2", "NH3")
    assert r["target_moles"] == pytest.approx(2.0)
    assert r["target_molar_mass"] == pytest.approx(17.031)
    assert r["target_grams"] == pytest.approx(34.062)


def test_stoichiometry_accepts_a_unit_prefixed_find():
    a = stoichiometry("C3H8 + O2 -> CO2 + H2O", "22 g C3H8", "grams of CO2")
    b = stoichiometry("C3H8 + O2 -> CO2 + H2O", "22 g C3H8", "CO2")
    assert a["target_grams"] == pytest.approx(b["target_grams"])


def test_stoichiometry_milligram_input_scales_correctly():
    r = stoichiometry("C3H8 + O2 -> CO2 + H2O", "22000 mg C3H8", "CO2")
    assert r["target_grams"] == pytest.approx(65.8683, rel=1e-5)


def test_stoichiometry_species_not_in_reaction_raises():
    with pytest.raises(ValueError, match="not in this reaction"):
        stoichiometry("C3H8 + O2 -> CO2 + H2O", "1 mol C3H8", "N2")


def test_stoichiometry_unknown_unit_raises():
    with pytest.raises(ValueError, match="unknown amount unit"):
        stoichiometry("C3H8 + O2 -> CO2 + H2O", "1 furlong C3H8", "CO2")


# ---------------------------------------------------------------------------
# Ideal gas law
# ---------------------------------------------------------------------------


def test_ideal_gas_solves_for_moles_at_stp():
    # One mole of an ideal gas occupies 22.414 L at 1 atm and 273.15 K.
    r = ideal_gas_law("P = 1 atm, V = 22.414 L, T = 273.15 K", "n")
    assert r["solved_for"] == "n"
    assert r["value"] == pytest.approx(1.0, rel=1e-5)


def test_ideal_gas_solves_for_volume_at_stp():
    r = ideal_gas_law("n = 1 mol, P = 1 atm, T = 273.15 K", "V")
    assert r["unit"] == "L"
    assert r["value"] == pytest.approx(22.414, rel=1e-4)


def test_ideal_gas_solves_for_pressure():
    # P = nRT/V = 2 * 8.314462618 * 300 / 0.010 m^3 = 498867.757 Pa = 4.923442 atm.
    r = ideal_gas_law("n = 2 mol, V = 10 L, T = 300 K", "P")
    assert r["value_si"] == pytest.approx(498867.757, rel=1e-6)
    assert r["value"] == pytest.approx(4.923442, rel=1e-5)


def test_ideal_gas_solves_for_temperature():
    # T = PV/(nR) = 101325 * 0.0224140 / (1 * 8.314462618) = 273.1504 K
    r = ideal_gas_law("P = 1 atm, V = 22.414 L, n = 1 mol", "T")
    assert r["value"] == pytest.approx(273.15, rel=1e-5)


def test_ideal_gas_celsius_input_is_converted_to_kelvin():
    # 0 C is 273.15 K, so this must match the STP result exactly.
    r = ideal_gas_law("P = 1 atm, V = 22.414 L, T = 0 C", "n")
    assert r["value"] == pytest.approx(1.0, rel=1e-5)


def test_ideal_gas_pressure_units_agree():
    # 101.325 kPa is 1 atm, so the same n comes out.
    r = ideal_gas_law("P = 101.325 kPa, V = 22.414 L, T = 273.15 K", "n")
    assert r["value"] == pytest.approx(1.0, rel=1e-5)


def test_ideal_gas_torr_input():
    # 760 torr = 1 atm exactly under the chemistry convention this tool uses.
    r = ideal_gas_law("P = 760 torr, V = 22.414 L, T = 273.15 K", "n")
    assert r["value"] == pytest.approx(1.0, rel=1e-5)


def test_ideal_gas_output_unit_can_be_requested():
    r = ideal_gas_law("n = 2 mol, V = 10 L, T = 300 K", "P in kPa")
    assert r["unit"] == "kPa"
    assert r["value"] == pytest.approx(498.867757, rel=1e-6)


def test_ideal_gas_missing_variable_raises():
    with pytest.raises(ValueError, match="missing"):
        ideal_gas_law("P = 1 atm, V = 22.4 L", "n")


def test_ideal_gas_unknown_unit_raises():
    with pytest.raises(ValueError, match="unknown P unit"):
        ideal_gas_law("P = 1 smoot, V = 22.4 L, T = 273 K", "n")


# ---------------------------------------------------------------------------
# pH
# ---------------------------------------------------------------------------


def test_ph_from_hydrogen_ion_concentration():
    r = ph_calculation("[H+] = 1e-3")
    assert r["pH"] == pytest.approx(3.0)
    assert r["pOH"] == pytest.approx(11.0)
    assert r["OH"] == pytest.approx(1e-11)
    assert r["acidity"] == "acidic"


def test_ph_to_concentration_roundtrip():
    # 10^-8.5 = 3.16228e-9 M
    r = ph_calculation("pH = 8.5")
    assert r["H"] == pytest.approx(3.162278e-9, rel=1e-5)
    assert r["OH"] == pytest.approx(3.162278e-6, rel=1e-5)
    assert r["pOH"] == pytest.approx(5.5)
    assert r["acidity"] == "basic"


def test_ph_from_hydroxide_concentration():
    # [OH-] = 1e-2 -> pOH 2 -> pH 12
    r = ph_calculation("[OH-] = 1e-2")
    assert r["pH"] == pytest.approx(12.0)
    assert r["H"] == pytest.approx(1e-12)


def test_pure_water_is_neutral():
    r = ph_calculation("[H+] = 1e-7")
    assert r["pH"] == pytest.approx(7.0)
    assert r["acidity"] == "neutral"


def test_weak_acid_equilibrium_acetic_acid():
    # 0.10 M acetic acid, Ka = 1.8e-5. Exact root of x^2/(C-x) = Ka:
    # x = (-Ka + sqrt(Ka^2 + 4*Ka*C)) / 2
    #   = (-1.8e-5 + sqrt(3.24e-10 + 7.2e-6)) / 2 = 1.332671e-3 M
    # pH = -log10(1.332671e-3) = 2.8753
    r = ph_calculation("Ka = 1.8e-5, C = 0.1")
    assert r["H"] == pytest.approx(1.332671e-3, rel=1e-5)
    assert r["pH"] == pytest.approx(2.8753, abs=1e-3)


def test_weak_base_equilibrium_ammonia():
    # 0.10 M NH3, Kb = 1.8e-5 -> [OH-] = 1.332671e-3, pOH = 2.8753, pH = 11.1247
    r = ph_calculation("Kb = 1.8e-5, C = 0.1")
    assert r["OH"] == pytest.approx(1.332671e-3, rel=1e-5)
    assert r["pH"] == pytest.approx(11.1247, abs=1e-3)


def test_weak_acid_without_concentration_raises():
    with pytest.raises(ValueError, match="formal concentration"):
        ph_calculation("Ka = 1.8e-5")


def test_ph_negative_concentration_raises():
    with pytest.raises(ValueError, match="must be positive"):
        ph_calculation("[H+] = -1")


# ---------------------------------------------------------------------------
# solve_chemistry / the Tool wrapper
# ---------------------------------------------------------------------------


def test_solve_chemistry_balance_reports_the_atom_count():
    result = solve_chemistry("balance_equation", equation="C3H8 + O2 -> CO2 + H2O")
    assert "C3H8 + 5 O2 -> 3 CO2 + 4 H2O" in result
    # 3 C, 8 H, 10 O on each side.
    assert "C: 3" in result and "H: 8" in result and "O: 10" in result


def test_solve_chemistry_stoichiometry_states_the_real_numbers():
    result = solve_chemistry(
        "stoichiometry", equation="C3H8 + O2 -> CO2 + H2O", given="22 g C3H8", find="CO2"
    )
    assert "65.8683" in result
    assert "44.097 g/mol" in result


def test_solve_chemistry_unknown_operation_raises():
    with pytest.raises(ValueError, match="unknown operation"):
        solve_chemistry("transmute", equation="Pb -> Au")


def test_solve_chemistry_balance_without_equation_raises():
    with pytest.raises(ValueError, match="needs an `equation`"):
        solve_chemistry("balance_equation")


async def test_tool_run_balances_for_real():
    tool = ChemistrySolverTool()
    result = await tool.run(operation="balance_equation", equation="Fe + O2 -> Fe2O3")
    assert "4 Fe + 3 O2 -> 2 Fe2O3" in result


async def test_tool_run_ideal_gas_law():
    tool = ChemistrySolverTool()
    result = await tool.run(operation="ideal_gas_law", given="n = 2 mol, V = 10 L, T = 300 K", find="P")
    assert "4.92344" in result
    # atm isn't SI, so the Pa value is worth restating.
    assert "498868 Pa in SI" in result


async def test_ideal_gas_output_does_not_restate_si_redundantly():
    tool = ChemistrySolverTool()
    result = await tool.run(
        operation="ideal_gas_law", given="P = 1 atm, V = 22.414 L, T = 273.15 K", find="n"
    )
    assert "n = 1 mol." in result
    assert "in SI" not in result


async def test_tool_run_ph():
    tool = ChemistrySolverTool()
    result = await tool.run(operation="ph", given="[H+] = 1e-3")
    assert "pH = 3" in result


async def test_tool_run_returns_error_string_not_exception():
    tool = ChemistrySolverTool()
    result = await tool.run(operation="balance_equation", equation="Na -> Cl")
    assert result.startswith("Error:")
