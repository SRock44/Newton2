"""Real, computed chemistry -- the same "verified, not vibes" standard symbolic_math
holds for algebra/calculus (see app/tools/symbolic_math.py and check_work.py).

Nothing in here asks a model whether an equation "looks balanced" or whether a
stoichiometry answer "seems right". Equations are balanced by building the real
element x species composition matrix and taking SymPy's `Matrix.nullspace()`;
stoichiometry uses molar masses summed from a real IUPAC standard-atomic-weight
table; PV = nRT is solved symbolically by SymPy with the CODATA gas constant; pH
uses real logarithms and (for weak acids/bases) the exact root of the equilibrium
quadratic. Every result carries the intermediate quantities it was derived from, so
the tutor can show the work instead of asserting a number.

What this handles, honestly:
  * Formulas with nested groups and brackets -- Ca(OH)2, Fe2(SO4)3, K4[Fe(CN)6].
  * Hydrate dots -- CuSO4*5H2O (use `*` or `.`, e.g. "CuSO4*5H2O").
  * Balancing anything with a one-dimensional solution space: combustion, single and
    double replacement, synthesis/decomposition, whole-molecule redox.

What it does NOT handle (deliberate, documented gaps -- it says so rather than
guessing):
  * Ionic charges / net-ionic half-reactions (no "SO4^2-"): balancing is by element
    conservation only, so redox is balanceable as whole neutral species but not by
    explicit electron transfer in acidic/basic solution.
  * Equations whose nullspace is more than one dimension (e.g. a species on both
    sides, or two independent reactions written as one) -- reported as
    underdetermined instead of one arbitrary answer being picked.
  * Isotope-specific masses (D, C-13): standard atomic weights only.
  * Limiting-reagent / percent-yield chains, and gas non-ideality.
"""

import math
import re
from collections import Counter
from functools import reduce
from typing import Any

import sympy

from app.tools.base import Tool

_OPERATIONS = {"balance_equation", "stoichiometry", "ideal_gas_law", "ph"}

# IUPAC standard atomic weights (2021 abridged, conventional values; for elements with
# no stable nuclide, the mass number of the longest-lived isotope). Real table, not
# rounded-to-the-nearest-integer approximations -- molar masses computed from it agree
# with a printed periodic table to the digits a chemistry course actually uses.
ATOMIC_WEIGHTS: dict[str, float] = {
    "H": 1.008, "He": 4.002602, "Li": 6.94, "Be": 9.0121831, "B": 10.81, "C": 12.011,
    "N": 14.007, "O": 15.999, "F": 18.998403163, "Ne": 20.1797, "Na": 22.98976928,
    "Mg": 24.305, "Al": 26.9815385, "Si": 28.085, "P": 30.973761998, "S": 32.06,
    "Cl": 35.45, "Ar": 39.948, "K": 39.0983, "Ca": 40.078, "Sc": 44.955908,
    "Ti": 47.867, "V": 50.9415, "Cr": 51.9961, "Mn": 54.938044, "Fe": 55.845,
    "Co": 58.933194, "Ni": 58.6934, "Cu": 63.546, "Zn": 65.38, "Ga": 69.723,
    "Ge": 72.630, "As": 74.921595, "Se": 78.971, "Br": 79.904, "Kr": 83.798,
    "Rb": 85.4678, "Sr": 87.62, "Y": 88.90584, "Zr": 91.224, "Nb": 92.90637,
    "Mo": 95.95, "Tc": 98.0, "Ru": 101.07, "Rh": 102.90550, "Pd": 106.42,
    "Ag": 107.8682, "Cd": 112.414, "In": 114.818, "Sn": 118.710, "Sb": 121.760,
    "Te": 127.60, "I": 126.90447, "Xe": 131.293, "Cs": 132.90545196, "Ba": 137.327,
    "La": 138.90547, "Ce": 140.116, "Pr": 140.90766, "Nd": 144.242, "Pm": 145.0,
    "Sm": 150.36, "Eu": 151.964, "Gd": 157.25, "Tb": 158.92535, "Dy": 162.500,
    "Ho": 164.93033, "Er": 167.259, "Tm": 168.93422, "Yb": 173.045, "Lu": 174.9668,
    "Hf": 178.49, "Ta": 180.94788, "W": 183.84, "Re": 186.207, "Os": 190.23,
    "Ir": 192.217, "Pt": 195.084, "Au": 196.966569, "Hg": 200.592, "Tl": 204.38,
    "Pb": 207.2, "Bi": 208.98040, "Po": 209.0, "At": 210.0, "Rn": 222.0, "Fr": 223.0,
    "Ra": 226.0, "Ac": 227.0, "Th": 232.0377, "Pa": 231.03588, "U": 238.02891,
    "Np": 237.0, "Pu": 244.0, "Am": 243.0, "Cm": 247.0, "Bk": 247.0, "Cf": 251.0,
    "Es": 252.0, "Fm": 257.0, "Md": 258.0, "No": 259.0, "Lr": 266.0, "Rf": 267.0,
    "Db": 268.0, "Sg": 269.0, "Bh": 270.0, "Hs": 269.0, "Mt": 278.0, "Ds": 281.0,
    "Rg": 282.0, "Cn": 285.0, "Nh": 286.0, "Fl": 289.0, "Mc": 290.0, "Lv": 293.0,
    "Ts": 294.0, "Og": 294.0,
}

# CODATA 2018. SI throughout internally (Pa, m^3, mol, K) so unit handling is one
# conversion in and one out, never a table of per-combination "R" values.
GAS_CONSTANT_J_PER_MOL_K = 8.314462618
_ATM_IN_PA = 101325.0
_KW_25C = 1.0e-14

_ELEMENT_RE = re.compile(r"[A-Z][a-z]?")
_ARROW_RE = re.compile(r"-{1,2}>|=>|→|⟶|<=>|<->|⇌|=")


def _fmt(x: float) -> str:
    return f"{float(x):.6g}"


# ---------------------------------------------------------------------------
# Formulas and molar mass
# ---------------------------------------------------------------------------


def parse_formula(formula: str) -> dict[str, int]:
    """Atom counts for one species, e.g. 'Fe2(SO4)3' -> {'Fe': 2, 'S': 3, 'O': 12}.

    Handles nested (), [], and a hydrate dot written as '*' or '.' ('CuSO4*5H2O').
    Raises ValueError -- with the offending text -- rather than silently dropping
    anything it doesn't understand, since a quietly-wrong atom count would poison
    every number downstream."""
    cleaned = formula.strip().replace(" ", "").replace("·", "*").replace("⋅", "*")
    if not cleaned:
        raise ValueError("empty chemical formula")

    # A hydrate dot separates independent units, each optionally multiplied.
    parts = re.split(r"[*.]", cleaned)
    total: Counter = Counter()
    for part in parts:
        if not part:
            raise ValueError(f"could not parse formula '{formula}': stray '*' or '.'")
        lead = re.match(r"^(\d+)", part)
        multiplier = 1
        if lead:
            multiplier = int(lead.group(1))
            part = part[lead.end():]
            if not part:
                raise ValueError(f"could not parse formula '{formula}': a number with no formula after it")
        for element, count in _parse_single_unit(part, formula).items():
            total[element] += count * multiplier
    return dict(total)


def _parse_single_unit(text: str, original: str) -> Counter:
    stack: list[Counter] = [Counter()]
    i = 0
    while i < len(text):
        ch = text[i]
        if ch in "([{":
            stack.append(Counter())
            i += 1
        elif ch in ")]}":
            if len(stack) == 1:
                raise ValueError(f"could not parse formula '{original}': unmatched '{ch}'")
            group = stack.pop()
            i += 1
            count, i = _read_int(text, i)
            for element, n in group.items():
                stack[-1][element] += n * count
        elif ch.isupper():
            match = _ELEMENT_RE.match(text, i)
            symbol = match.group(0)
            if symbol not in ATOMIC_WEIGHTS:
                # 'Xy' may really be element 'X' followed by something else.
                if len(symbol) == 2 and symbol[0] in ATOMIC_WEIGHTS:
                    symbol = symbol[0]
                else:
                    raise ValueError(f"could not parse formula '{original}': '{symbol}' is not an element symbol")
            i += len(symbol)
            count, i = _read_int(text, i)
            stack[-1][symbol] += count
        else:
            raise ValueError(
                f"could not parse formula '{original}': unexpected '{ch}' "
                "(ionic charges like 'SO4^2-' aren't supported)"
            )
    if len(stack) != 1:
        raise ValueError(f"could not parse formula '{original}': unclosed group")
    return stack[0]


def _read_int(text: str, i: int) -> tuple[int, int]:
    match = re.match(r"\d+", text[i:])
    if not match:
        return 1, i
    return int(match.group(0)), i + match.end()


def molar_mass(formula: str) -> float:
    """Grams per mole, summed from ATOMIC_WEIGHTS. C3H8 -> 44.097."""
    counts = parse_formula(formula)
    return sum(ATOMIC_WEIGHTS[element] * n for element, n in counts.items())


# ---------------------------------------------------------------------------
# Balancing -- real linear algebra over the composition matrix
# ---------------------------------------------------------------------------


def _split_side(side: str) -> list[tuple[int, str]]:
    """'5 O2 + 2H2O' -> [(5, 'O2'), (2, 'H2O')]. A formula never starts with a digit,
    so leading digits are unambiguously a stoichiometric coefficient."""
    species: list[tuple[int, str]] = []
    for token in side.split("+"):
        token = token.strip()
        if not token:
            raise ValueError("empty species in equation (stray '+')")
        match = re.match(r"^(\d+)\s*(.+)$", token)
        if match:
            species.append((int(match.group(1)), match.group(2).strip()))
        else:
            species.append((1, token))
    return species


def split_equation(equation: str) -> tuple[list[tuple[int, str]], list[tuple[int, str]]]:
    parts = _ARROW_RE.split(equation)
    if len(parts) != 2:
        raise ValueError(
            f"could not read '{equation}' as a reaction -- expected exactly one arrow, "
            "e.g. 'C3H8 + O2 -> CO2 + H2O'"
        )
    left, right = _split_side(parts[0]), _split_side(parts[1])
    if not left or not right:
        raise ValueError(f"could not read '{equation}': both sides need at least one species")
    return left, right


def balance(equation: str) -> tuple[list[tuple[int, str]], list[tuple[int, str]]]:
    """The real balanced coefficients, as (reactants, products) lists of
    (coefficient, formula).

    Method: one row per element, one column per species, +count on the reactant side
    and -count on the product side. Conservation of each element is exactly
    `M @ c == 0`, so the balance is a basis vector of M's nullspace -- scaled by the
    LCM of its denominators and reduced by the GCD to give the smallest positive
    integers. Any coefficients already written in the input are ignored here; they're
    checked against this result separately, never trusted as the answer."""
    left, right = split_equation(equation)
    formulas = [f for _, f in left] + [f for _, f in right]
    compositions = [parse_formula(f) for f in formulas]
    elements = sorted({e for comp in compositions for e in comp})

    n_left = len(left)
    rows = [
        [
            sympy.Integer(comp.get(element, 0)) * (1 if col < n_left else -1)
            for col, comp in enumerate(compositions)
        ]
        for element in elements
    ]
    nullspace = sympy.Matrix(rows).nullspace()

    if not nullspace:
        raise ValueError(
            f"'{equation}' cannot be balanced -- no non-zero set of coefficients conserves "
            "every element. Check the formulas; a species may be missing or mistyped."
        )
    if len(nullspace) > 1:
        raise ValueError(
            f"'{equation}' is underdetermined: {len(nullspace)} independent balances exist, "
            "so there is no single correct answer. This happens when a species appears on "
            "both sides or two separate reactions are written as one. Split it up and "
            "balance each reaction on its own."
        )

    vector = nullspace[0]
    denominators = [sympy.Rational(v).q for v in vector]
    scale = reduce(sympy.ilcm, denominators, 1)
    coefficients = [int(sympy.Rational(v) * scale) for v in vector]
    if all(c <= 0 for c in coefficients):
        coefficients = [-c for c in coefficients]
    divisor = reduce(math.gcd, [abs(c) for c in coefficients])
    coefficients = [c // divisor for c in coefficients]

    if any(c <= 0 for c in coefficients):
        raise ValueError(
            f"'{equation}' has no balance with all-positive coefficients -- as written, some "
            "species would need a negative amount. Check which side each species is on."
        )

    return (
        [(coefficients[i], f) for i, (_, f) in enumerate(left)],
        [(coefficients[n_left + i], f) for i, (_, f) in enumerate(right)],
    )


def _side_atoms(side: list[tuple[int, str]]) -> dict[str, int]:
    """Total atoms of each element on one side, with its coefficients applied -- what
    makes the balance checkable at a glance rather than just asserted."""
    totals: Counter = Counter()
    for coefficient, formula in side:
        for element, count in parse_formula(formula).items():
            totals[element] += coefficient * count
    return dict(totals)


def _render_side(side: list[tuple[int, str]]) -> str:
    return " + ".join(f"{formula}" if coeff == 1 else f"{coeff} {formula}" for coeff, formula in side)


def format_balanced(equation: str) -> str:
    left, right = balance(equation)
    return f"{_render_side(left)} -> {_render_side(right)}"


def _given_coefficients_disagree(equation: str, left: list, right: list) -> bool:
    """True when the caller wrote explicit coefficients that aren't just a multiple of
    the computed balance -- worth saying out loud rather than silently overriding."""
    original_left, original_right = split_equation(equation)
    given = [c for c, _ in original_left] + [c for c, _ in original_right]
    computed = [c for c, _ in left] + [c for c, _ in right]
    if all(c == 1 for c in given):
        return False  # nothing was actually asserted
    ratios = {sympy.Rational(g, c) for g, c in zip(given, computed)}
    return len(ratios) != 1


# ---------------------------------------------------------------------------
# Stoichiometry
# ---------------------------------------------------------------------------

_MASS_UNITS_G = {"g": 1.0, "gram": 1.0, "grams": 1.0, "kg": 1000.0, "mg": 0.001}
_MOLE_UNITS_MOL = {"mol": 1.0, "mole": 1.0, "moles": 1.0, "mmol": 0.001, "kmol": 1000.0}

_GIVEN_RE = re.compile(
    r"^\s*([-+0-9.eE]+)\s*([A-Za-z]+)\s*(?:of\s+)?(\S+)\s*$",
)


def _parse_quantity(given: str) -> tuple[float, str, str]:
    """'22 g C3H8' -> (22.0, 'g', 'C3H8'). Amount, unit, species."""
    match = _GIVEN_RE.match(given.strip())
    if not match:
        raise ValueError(
            f"could not read '{given}' as a quantity -- expected e.g. '22 g C3H8' or '0.5 mol O2'"
        )
    raw_value, unit, species = match.groups()
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise ValueError(f"could not read '{raw_value}' as a number") from exc
    unit = unit.lower()
    if unit not in _MASS_UNITS_G and unit not in _MOLE_UNITS_MOL:
        raise ValueError(
            f"unknown amount unit '{unit}' -- use grams (g, kg, mg) or moles (mol, mmol, kmol)"
        )
    return value, unit, species


def _find_species(target: str) -> str:
    """'grams of CO2' / 'mol CO2' / 'CO2' -> 'CO2'."""
    cleaned = re.sub(
        r"^\s*(grams?|g|kg|mg|moles?|mol|mmol|kmol)\s+(of\s+)?", "", target.strip(), flags=re.IGNORECASE
    )
    cleaned = cleaned.strip()
    if not cleaned:
        raise ValueError(f"could not tell which species '{target}' refers to")
    return cleaned


def _coefficient_of(species: str, left: list, right: list) -> int:
    for coeff, formula in left + right:
        if formula == species:
            return coeff
    # Fall back on composition equality so 'HOH' matches 'H2O' and spacing/order vary.
    wanted = parse_formula(species)
    for coeff, formula in left + right:
        if parse_formula(formula) == wanted:
            return coeff
    known = ", ".join(f for _, f in left + right)
    raise ValueError(f"'{species}' is not in this reaction (species are: {known})")


def stoichiometry(equation: str, given: str, find: str) -> dict[str, Any]:
    value, unit, known_species = _parse_quantity(given)
    target_species = _find_species(find)

    left, right = balance(equation)
    known_coeff = _coefficient_of(known_species, left, right)
    target_coeff = _coefficient_of(target_species, left, right)

    known_mm = molar_mass(known_species)
    target_mm = molar_mass(target_species)

    if unit in _MOLE_UNITS_MOL:
        known_moles = value * _MOLE_UNITS_MOL[unit]
        known_grams = known_moles * known_mm
    else:
        known_grams = value * _MASS_UNITS_G[unit]
        known_moles = known_grams / known_mm

    target_moles = known_moles * target_coeff / known_coeff
    target_grams = target_moles * target_mm

    return {
        "balanced_equation": f"{_render_side(left)} -> {_render_side(right)}",
        "coefficients_were_given_but_wrong": _given_coefficients_disagree(equation, left, right),
        "known_species": known_species,
        "known_molar_mass": known_mm,
        "known_moles": known_moles,
        "known_grams": known_grams,
        "known_coefficient": known_coeff,
        "target_species": target_species,
        "target_molar_mass": target_mm,
        "target_coefficient": target_coeff,
        "target_moles": target_moles,
        "target_grams": target_grams,
    }


# ---------------------------------------------------------------------------
# Ideal gas law
# ---------------------------------------------------------------------------

_PRESSURE_PA = {
    "pa": 1.0, "kpa": 1000.0, "hpa": 100.0, "atm": _ATM_IN_PA,
    "bar": 100000.0, "mbar": 100.0,
    # The chemistry convention: 760 mmHg = 760 torr = 1 atm exactly.
    "torr": _ATM_IN_PA / 760.0, "mmhg": _ATM_IN_PA / 760.0,
    "psi": 6894.757293168361,
}
_VOLUME_M3 = {"l": 0.001, "ml": 1e-6, "dm3": 0.001, "cm3": 1e-6, "m3": 1.0, "m^3": 1.0, "liter": 0.001, "liters": 0.001}
_AMOUNT_MOL = {"mol": 1.0, "mmol": 0.001, "kmol": 1000.0, "mole": 1.0, "moles": 1.0}

_IGL_VARIABLES = {
    "p": "P", "pressure": "P",
    "v": "V", "volume": "V",
    "n": "n", "moles": "n", "mol": "n", "amount": "n",
    "t": "T", "temperature": "T", "temp": "T",
}
_IGL_DEFAULT_UNITS = {"P": "atm", "V": "L", "n": "mol", "T": "K"}
_IGL_TABLES = {"P": _PRESSURE_PA, "V": _VOLUME_M3, "n": _AMOUNT_MOL}


def _to_kelvin(value: float, unit: str) -> float:
    unit = unit.lower().lstrip("°")
    if unit == "k":
        return value
    if unit == "c":
        return value + 273.15
    if unit == "f":
        return (value - 32.0) * 5.0 / 9.0 + 273.15
    raise ValueError(f"unknown temperature unit '{unit}' -- use K, C, or F")


def _from_kelvin(value_k: float, unit: str) -> float:
    unit = unit.lower().lstrip("°")
    if unit == "k":
        return value_k
    if unit == "c":
        return value_k - 273.15
    if unit == "f":
        return (value_k - 273.15) * 9.0 / 5.0 + 32.0
    raise ValueError(f"unknown temperature unit '{unit}' -- use K, C, or F")


def _to_si(variable: str, value: float, unit: str) -> float:
    if variable == "T":
        return _to_kelvin(value, unit)
    table = _IGL_TABLES[variable]
    key = unit.lower().replace("³", "3")
    if key not in table:
        raise ValueError(f"unknown {variable} unit '{unit}' -- known: {', '.join(sorted(table))}")
    return value * table[key]


def _from_si(variable: str, value_si: float, unit: str) -> float:
    if variable == "T":
        return _from_kelvin(value_si, unit)
    table = _IGL_TABLES[variable]
    key = unit.lower().replace("³", "3")
    if key not in table:
        raise ValueError(f"unknown {variable} unit '{unit}' -- known: {', '.join(sorted(table))}")
    return value_si / table[key]


_IGL_TERM_RE = re.compile(r"^\s*([A-Za-z]+)\s*=\s*([-+0-9.eE]+)\s*(\S*)\s*$")


def _parse_igl_given(given: str) -> dict[str, tuple[float, str]]:
    known: dict[str, tuple[float, str]] = {}
    for term in re.split(r"[,;]", given):
        if not term.strip():
            continue
        match = _IGL_TERM_RE.match(term)
        if not match:
            raise ValueError(
                f"could not read '{term.strip()}' -- expected 'P = 1 atm' style terms separated by commas"
            )
        name, raw_value, unit = match.groups()
        variable = _IGL_VARIABLES.get(name.lower())
        if variable is None:
            raise ValueError(f"'{name}' is not one of P, V, n, T")
        if not unit:
            unit = _IGL_DEFAULT_UNITS[variable]
        known[variable] = (float(raw_value), unit)
    return known


def ideal_gas_law(given: str, find: str) -> dict[str, Any]:
    """Solves PV = nRT for whichever of P, V, n, T is asked for, given the other
    three. SymPy does the algebra; unit conversion happens only at the boundary."""
    find = find.strip()
    unit_match = re.search(r"\bin\s+(\S+)\s*$", find, flags=re.IGNORECASE)
    requested_unit = None
    if unit_match:
        requested_unit = unit_match.group(1)
        find = find[: unit_match.start()].strip()
    target = _IGL_VARIABLES.get(find.lower().strip())
    if target is None:
        raise ValueError(f"'{find}' is not one of P, V, n, T")

    known = _parse_igl_given(given)
    known.pop(target, None)
    missing = [v for v in ("P", "V", "n", "T") if v != target and v not in known]
    if missing:
        raise ValueError(
            f"need all three of the other variables to solve for {target}; missing {', '.join(missing)}"
        )

    symbols = {name: sympy.Symbol(name, positive=True) for name in ("P", "V", "n", "T")}
    equation = sympy.Eq(
        symbols["P"] * symbols["V"],
        symbols["n"] * sympy.Float(GAS_CONSTANT_J_PER_MOL_K) * symbols["T"],
    )
    substitutions = {symbols[v]: sympy.Float(_to_si(v, value, unit)) for v, (value, unit) in known.items()}
    solutions = sympy.solve(equation.subs(substitutions), symbols[target])
    if not solutions:
        raise ValueError(f"no physical solution for {target} from the values given")
    value_si = float(solutions[0])

    out_unit = requested_unit or _IGL_DEFAULT_UNITS[target]
    return {
        "solved_for": target,
        "value": _from_si(target, value_si, out_unit),
        "unit": out_unit,
        "value_si": value_si,
        "si_unit": {"P": "Pa", "V": "m^3", "n": "mol", "T": "K"}[target],
        "known_si": {v: _to_si(v, value, unit) for v, (value, unit) in known.items()},
        "known_as_given": {v: f"{_fmt(value)} {unit}" for v, (value, unit) in known.items()},
    }


# ---------------------------------------------------------------------------
# pH
# ---------------------------------------------------------------------------

_PH_TERM_RE = re.compile(r"^\s*(\[H\+\]|\[H3O\+\]|\[OH-\]|pH|pOH|Ka|Kb|C|c|conc|concentration)\s*=\s*([-+0-9.eE]+)", re.IGNORECASE)
_PH_KEYS = {
    "[h+]": "H", "[h3o+]": "H", "[oh-]": "OH", "ph": "pH", "poh": "pOH",
    "ka": "Ka", "kb": "Kb", "c": "C", "conc": "C", "concentration": "C",
}


def _parse_ph_given(given: str) -> dict[str, float]:
    known: dict[str, float] = {}
    for term in re.split(r"[,;]", given):
        if not term.strip():
            continue
        match = _PH_TERM_RE.match(term)
        if not match:
            raise ValueError(
                f"could not read '{term.strip()}' -- expected e.g. 'pH = 3.2', '[H+] = 1e-3', "
                "or 'Ka = 1.8e-5, C = 0.1'"
            )
        key = _PH_KEYS[match.group(1).lower()]
        known[key] = float(match.group(2))
    if not known:
        raise ValueError("nothing given to compute pH from")
    return known


def ph_calculation(given: str) -> dict[str, Any]:
    """Interconverts pH / pOH / [H+] / [OH-] at 25 C (Kw = 1.0e-14), and solves a weak
    acid/base equilibrium exactly when given Ka (or Kb) plus a formal concentration.

    The weak-acid case solves x^2/(C - x) = Ka for the real positive root with SymPy --
    the exact quadratic, not the "x is small, so C - x ~ C" shortcut, so it stays right
    for concentrations where that approximation quietly breaks down."""
    known = _parse_ph_given(given)
    notes: list[str] = []

    if "Ka" in known or "Kb" in known:
        if "C" not in known:
            raise ValueError("a weak-acid/base calculation also needs the formal concentration, e.g. 'C = 0.1'")
        constant = known.get("Ka", known.get("Kb"))
        concentration = known["C"]
        if constant <= 0 or concentration <= 0:
            raise ValueError("Ka/Kb and concentration must both be positive")
        x = sympy.Symbol("x", positive=True)
        roots = sympy.solve(sympy.Eq(x**2 / (sympy.Float(concentration) - x), sympy.Float(constant)), x)
        physical = [float(r) for r in roots if r.is_real and 0 < float(r) < concentration]
        if not physical:
            raise ValueError("no physical root for this equilibrium -- check Ka/Kb and concentration")
        ion = physical[0]
        if "Ka" in known:
            h = ion
            notes.append(
                f"Weak acid: solved x^2/({_fmt(concentration)} - x) = {_fmt(constant)} exactly for "
                f"x = [H+] = {_fmt(ion)} M ({100 * ion / concentration:.3g}% ionized)."
            )
        else:
            oh = ion
            h = _KW_25C / oh
            notes.append(
                f"Weak base: solved x^2/({_fmt(concentration)} - x) = {_fmt(constant)} exactly for "
                f"x = [OH-] = {_fmt(ion)} M ({100 * ion / concentration:.3g}% ionized)."
            )
    elif "H" in known:
        h = known["H"]
        if h <= 0:
            raise ValueError("[H+] must be positive")
    elif "OH" in known:
        if known["OH"] <= 0:
            raise ValueError("[OH-] must be positive")
        h = _KW_25C / known["OH"]
    elif "pH" in known:
        h = 10.0 ** (-known["pH"])
    elif "pOH" in known:
        h = 10.0 ** (-(14.0 - known["pOH"]))
    else:
        raise ValueError("give one of pH, pOH, [H+], [OH-], or Ka/Kb with a concentration")

    oh = _KW_25C / h
    ph = -math.log10(h)
    return {
        "pH": ph,
        "pOH": 14.0 - ph,
        "H": h,
        "OH": oh,
        "acidity": "acidic" if ph < 6.999999 else ("basic" if ph > 7.000001 else "neutral"),
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# The single tutor-facing entry point
# ---------------------------------------------------------------------------


def solve_chemistry(operation: str, equation: str = "", given: str = "", find: str = "") -> str:
    if operation not in _OPERATIONS:
        raise ValueError(f"unknown operation '{operation}', expected one of {sorted(_OPERATIONS)}")

    if operation == "balance_equation":
        if not equation.strip():
            raise ValueError("balance_equation needs an `equation`, e.g. 'C3H8 + O2 -> CO2 + H2O'")
        left, right = balance(equation)
        balanced = f"{_render_side(left)} -> {_render_side(right)}"
        check = ", ".join(f"{element}: {count}" for element, count in sorted(_side_atoms(left).items()))
        return (
            f"Balanced (by real linear algebra on the composition matrix -- SymPy "
            f"nullspace, not a guess): {balanced}\n"
            f"Atom count on each side now: {check}."
        )

    if operation == "stoichiometry":
        if not equation.strip():
            raise ValueError("stoichiometry needs an `equation`")
        if not given.strip() or not find.strip():
            raise ValueError("stoichiometry needs `given` (e.g. '22 g C3H8') and `find` (e.g. 'CO2')")
        r = stoichiometry(equation, given, find)
        lines = [
            f"Balanced equation used (computed, not taken on trust): {r['balanced_equation']}",
            f"Molar masses from the real atomic-weight table: {r['known_species']} = "
            f"{_fmt(r['known_molar_mass'])} g/mol, {r['target_species']} = {_fmt(r['target_molar_mass'])} g/mol.",
            f"{r['known_species']}: {_fmt(r['known_grams'])} g = {_fmt(r['known_moles'])} mol.",
            f"Mole ratio {r['target_species']}:{r['known_species']} = "
            f"{r['target_coefficient']}:{r['known_coefficient']}.",
            f"ANSWER: {_fmt(r['target_moles'])} mol {r['target_species']} = "
            f"{_fmt(r['target_grams'])} g {r['target_species']}.",
            "Assumes the reaction goes to completion with this species limiting -- if the problem "
            "gives amounts of more than one reactant, the limiting reagent has to be settled first.",
        ]
        if r["coefficients_were_given_but_wrong"]:
            lines.insert(
                1,
                "NOTE: the coefficients in the equation as written are not a correct balance; "
                "the computed balance above was used instead. Worth pointing this out to the student.",
            )
        return "\n".join(lines)

    if operation == "ideal_gas_law":
        if not given.strip() or not find.strip():
            raise ValueError(
                "ideal_gas_law needs `given` (e.g. 'P = 1 atm, V = 22.4 L, T = 273.15 K') and "
                "`find` (one of P, V, n, T)"
            )
        r = ideal_gas_law(given, find)
        knowns = ", ".join(f"{k} = {v}" for k, v in r["known_as_given"].items())
        # Only restate in SI when that's actually a different unit -- "1 mol (= 1 mol in
        # SI)" is noise.
        in_si = (
            ""
            if r["unit"].lower().replace("³", "3") == r["si_unit"].lower().replace("^3", "3")
            else f" (= {_fmt(r['value_si'])} {r['si_unit']} in SI)"
        )
        return (
            f"Solved PV = nRT for {r['solved_for']} with SymPy (R = {GAS_CONSTANT_J_PER_MOL_K} "
            f"J/mol/K, CODATA), given {knowns}.\n"
            f"ANSWER: {r['solved_for']} = {_fmt(r['value'])} {r['unit']}{in_si}.\n"
            "Ideal-gas assumption -- real gases deviate at high pressure or near condensation."
        )

    if not given.strip():
        raise ValueError(
            "ph needs `given`, e.g. '[H+] = 1e-3', 'pH = 8.5', or 'Ka = 1.8e-5, C = 0.1'"
        )
    r = ph_calculation(given)
    lines = list(r["notes"])
    lines.append(
        f"At 25 C (Kw = 1.0e-14): pH = {r['pH']:.4g}, pOH = {r['pOH']:.4g}, "
        f"[H+] = {_fmt(r['H'])} M, [OH-] = {_fmt(r['OH'])} M -- {r['acidity']}."
    )
    lines.append("Computed with real logarithms; Kw is temperature-dependent, so this is the 25 C value.")
    return "\n".join(lines)


class ChemistrySolverTool(Tool):
    """Chemistry's counterpart to symbolic_math: the answer is computed, never
    reasoned toward. Balancing is a nullspace computation over the real composition
    matrix, stoichiometry uses real IUPAC atomic weights, PV = nRT is solved by SymPy,
    and pH uses real logs and the exact equilibrium root -- so the tutor can state a
    coefficient or a mass the same way it states a derivative: because it was
    calculated."""

    name = "chemistry_solver"
    description = (
        "Real computed chemistry, never estimated: balance_equation (balances a "
        "chemical equation by actual linear algebra), stoichiometry (grams/moles of "
        "one species from a known amount of another, via real molar masses), "
        "ideal_gas_law (solves PV=nRT for P, V, n, or T with real units), and ph "
        "(pH/pOH/[H+]/[OH-] interconversion, plus exact weak-acid/base Ka/Kb "
        "equilibrium). Use instead of working a chemistry problem out by hand."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "operation": {"type": "string", "enum": sorted(_OPERATIONS)},
            "equation": {
                "type": "string",
                "description": (
                    "For balance_equation/stoichiometry: the reaction, e.g. "
                    "'C3H8 + O2 -> CO2 + H2O'. Coefficients are optional and are "
                    "recomputed rather than trusted. No ionic charges."
                ),
            },
            "given": {
                "type": "string",
                "description": (
                    "The known quantity. stoichiometry: '22 g C3H8' or '0.5 mol O2'. "
                    "ideal_gas_law: 'P = 1 atm, V = 22.4 L, T = 273.15 K' (any three "
                    "of P/V/n/T; units atm, kPa, Pa, bar, torr, mmHg, psi / L, mL, "
                    "m^3 / mol, mmol / K, C, F). ph: '[H+] = 1e-3', 'pH = 8.5', "
                    "'[OH-] = 2e-5', or 'Ka = 1.8e-5, C = 0.1'."
                ),
            },
            "find": {
                "type": "string",
                "description": (
                    "What to compute. stoichiometry: the other species, e.g. 'CO2'. "
                    "ideal_gas_law: 'P', 'V', 'n', or 'T', optionally 'P in kPa'. "
                    "Not needed for balance_equation or ph."
                ),
            },
        },
        "required": ["operation"],
    }

    async def run(self, operation: str, equation: str = "", given: str = "", find: str = "") -> str:
        try:
            return solve_chemistry(operation, equation or "", given or "", find or "")
        except Exception as exc:
            return f"Error: {exc}"
