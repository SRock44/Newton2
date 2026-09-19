"""check_proof_work -- structured critique of a student's own WRITTEN PROOF.

Same honesty philosophy as check_work.py's `check_student_work`, applied to the one
huge category that tool structurally can't touch: proofs. `check_student_work` has a
real computational ground truth for six SymPy operations (solve/differentiate/
integrate/simplify/factor/expand) and an honest "no ground truth, reason carefully"
fallback for everything else. A real-analysis or abstract-algebra course lives almost
entirely in that fallback bucket -- the bulk of the coursework is proofs (induction,
contradiction, contrapositive, case analysis, direct proof), and SymPy has no natural-
deduction engine. There is no algorithm that decides general logical validity, so this
tool never claims one.

What it actually does, and says out loud in its own response text (not just in this
docstring -- see the "COMPUTATIONALLY VERIFIED" / "STRUCTURAL / LOGICAL CRITIQUE"
headers `run()` emits):

1. Extracts any real algebraic/computational sub-claim inside the proof text (an
   equation, an expansion, a simplification -- e.g. "(n+1)^2 = n^2 + 2n + 1") and
   verifies it for REAL via `_parse`/sympy, reusing symbolic_math's own parser rather
   than reinventing one (the same convention check_work.py already follows for its
   own math delegation). These are reported as genuinely VERIFIED, correct or wrong.

2. Detects which proof technique is being used from the student's own wording
   (induction / contradiction / contrapositive / case analysis / direct, in that
   priority order since "contrapositive"/"base case"/"inductive step" are unambiguous
   keywords while "case" is not) and runs technique-specific STRUCTURAL checks:
   induction's base case + real inductive step, contradiction's negated assumption +
   an actually-derived contradiction, contrapositive's direction (assume NOT-Q, derive
   NOT-P), case analysis's labeled-case count. These are pattern/keyword heuristics on
   the student's own text, not a logic engine -- reported as a careful REASONING-BASED
   judgment, explicitly labeled as such, never as "verified".

3. Runs a general "proved the converse / affirmed the consequent" detector against any
   claim phrased as "if P then Q" (a very common real student error, and textually
   indistinguishable from affirming the consequent when a direct proof does it), plus a
   fallacy checklist the calling model is told to explicitly check by name.

Known reliability limits (stated here honestly, not just papered over): proof-technique
detection and the direction/converse check are keyword/word-overlap heuristics over
free text, not a parser for natural language logic. They work well on proofs that use
the standard vocabulary (as taught in an actual class) and can miss or misfire on
unusually phrased ones -- which is exactly why the tool's own response text insists the
structural section is a judgment call for the model to confirm, never a verified fact
the way the algebra section is.
"""

import re
from typing import Any

import sympy

from app.tools.base import Tool
from app.tools.check_work import _looks_like_math
from app.tools.symbolic_math import _parse

# --- technique detection ----------------------------------------------------------

_CONTRAPOSITIVE_RE = re.compile(r"\bcontrapositive\b", re.IGNORECASE)
_INDUCTION_RE = re.compile(
    r"\b(induction|base case|inductive step|inductive hypothesis)\b", re.IGNORECASE
)
_CONTRADICTION_RE = re.compile(
    r"\b(contradiction|for the sake of contradiction|towards a contradiction)\b"
    r"|\b(suppose|assume)\b[^.\n]*\b(not|false|contrary)\b",
    re.IGNORECASE,
)
_CASE_LABEL_RE = re.compile(r"\bcase\s*[0-9a-z]+\b", re.IGNORECASE)


def _detect_technique(proof: str) -> str:
    """Priority order matters: 'contrapositive'/'base case'/'inductive step' are
    unambiguous vocabulary a student wouldn't use by accident, so they're checked
    before the fuzzier contradiction/case signals. Falls back to 'direct' -- the safe
    default when no specific technique is named or detectable, since a direct-proof
    critique (does each step follow?) is a reasonable thing to run on anything."""
    if _CONTRAPOSITIVE_RE.search(proof):
        return "contrapositive"
    if _INDUCTION_RE.search(proof):
        return "induction"
    if _CONTRADICTION_RE.search(proof):
        return "contradiction"
    if len(set(m.group(0).lower() for m in _CASE_LABEL_RE.finditer(proof))) >= 2:
        return "cases"
    return "direct"


# --- shared text-heuristic helpers --------------------------------------------------

_STOPWORDS = {
    "the", "a", "an", "is", "are", "be", "of", "to", "for", "that", "this", "and", "or",
    "then", "if", "we", "will", "prove", "let", "some", "any", "all", "every", "which",
    "with", "such", "must", "can", "when", "there", "exists", "given", "show", "shown",
}
_NEGATION_RE = re.compile(
    r"\b(not|isn't|aren't|doesn't|don't|no|non-|never|cannot|can't|false)\b", re.IGNORECASE
)
_IF_THEN_RE = re.compile(r"\bif\s+(.+?)\s*,?\s*\bthen\b\s+(.+)", re.IGNORECASE)
_IMPLIES_RE = re.compile(r"(.+?)\s+\bimplies\b\s+(.+)", re.IGNORECASE)
_ASSUME_RE = re.compile(r"\b(assume|suppose)\b\s+(that\s+)?([^.\n]+)", re.IGNORECASE)
_CONCLUDE_LINE_RE = re.compile(r"^\s*(therefore|thus|hence|so)\b[,:]?\s*(.+)$", re.IGNORECASE)


def _keywords(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Z]+", text.lower())
    return {w for w in words if len(w) >= 3 and w not in _STOPWORDS}


def _overlap_ratio(text: str, reference_keywords: set[str]) -> float:
    if not reference_keywords:
        return 0.0
    return len(_keywords(text) & reference_keywords) / len(reference_keywords)


def _has_negation(text: str) -> bool:
    return bool(_NEGATION_RE.search(text))


def _parse_implication(claim: str) -> tuple[str, str] | None:
    m = _IF_THEN_RE.search(claim) or _IMPLIES_RE.search(claim)
    if not m:
        return None
    return m.group(1).strip(" .,"), m.group(2).strip(" .,")


def _find_assumption(proof: str) -> str:
    m = _ASSUME_RE.search(proof)
    return m.group(3).strip(" .,") if m else ""


def _find_conclusion(proof: str) -> str:
    lines = [ln.strip() for ln in proof.splitlines() if ln.strip()]
    for line in reversed(lines):
        m = _CONCLUDE_LINE_RE.match(line)
        if m:
            return m.group(2).strip(" .,")
    return lines[-1].strip(" .,") if lines else ""


def _check_direction(claim: str, proof: str) -> list[str]:
    """General 'did this actually prove Q => P instead of the stated P => Q' check --
    catches BOTH the classic "proved the converse" student error and, when the proof
    presents itself as a direct proof, the "affirming the consequent" fallacy, since
    the two are textually indistinguishable from the proof's own wording alone."""
    implication = _parse_implication(claim)
    if implication is None:
        return [
            "Couldn't parse the claim as a clean 'if P then Q' implication, so the "
            "proved-the-converse/affirming-the-consequent check below wasn't run "
            "structurally -- check by hand that the direction of implication actually "
            "matches what was asked."
        ]
    p_text, q_text = implication
    p_kw, q_kw = _keywords(p_text), _keywords(q_text)

    assumption_text = _find_assumption(proof)
    conclusion_text = _find_conclusion(proof)
    if not assumption_text or not conclusion_text:
        return [
            "Couldn't clearly find both a stated assumption and a stated conclusion in "
            "the proof to check direction against -- read it yourself to confirm it "
            f"actually proves 'if {p_text} then {q_text}' and not its converse."
        ]

    assumes_q = (
        _overlap_ratio(assumption_text, q_kw) >= 0.5
        and _has_negation(assumption_text) == _has_negation(q_text)
    )
    concludes_p = (
        _overlap_ratio(conclusion_text, p_kw) >= 0.5
        and _has_negation(conclusion_text) == _has_negation(p_text)
    )

    if assumes_q and concludes_p:
        return [
            "FLAGGED -- this proof's structure assumes the CONSEQUENT ('" + q_text +
            "') and derives the ANTECEDENT ('" + p_text + "'). For the claim 'if " +
            p_text + " then " + q_text + "', assuming Q and deriving P is the CONVERSE "
            "(Q => P), not the stated claim (P => Q). If this was meant to be a "
            "contrapositive proof, a genuine contrapositive assumes NOT-Q and derives "
            "NOT-P, not Q and P directly. If it's presented as a direct proof, this is "
            "the 'affirming the consequent' fallacy -- quote the assumption and "
            "conclusion sentences back to the student and ask them to re-check the "
            "direction."
        ]
    return [
        "No sign of the classic 'proved the converse' / 'affirmed the consequent' "
        "error (the proof's stated assumption and conclusion don't obviously match Q "
        "and P respectively) -- still worth a manual sanity check of the direction."
    ]


def _check_quantifiers(claim: str, proof: str) -> list[str]:
    is_universal = bool(re.search(r"\b(for all|for every|every|any)\b", claim, re.IGNORECASE))
    if not is_universal:
        return []
    concrete = re.findall(r"\b[a-z]\s*=\s*-?\d+\b", proof, re.IGNORECASE)
    generalized = bool(
        re.search(r"\bfor (any|all|arbitrary)\b|\blet\s+[a-z]\s+be\s+(an?\s+)?arbitrary\b", proof, re.IGNORECASE)
    )
    if concrete and not generalized:
        return [
            f"FLAGGED -- the claim is universal ('for all'/'every'), but the proof "
            f"appears to only check a specific value ({concrete[0].strip()}) rather than "
            "reasoning about an arbitrary/general case. One example never proves a "
            "universal claim (proof by example) -- confirm whether the proof actually "
            "generalizes or just checked one number."
        ]
    return []


# --- technique-specific structural checks -------------------------------------------


def _check_induction(proof: str) -> list[str]:
    findings = []
    has_base = bool(re.search(r"\bbase case\b", proof, re.IGNORECASE))
    if has_base:
        findings.append("OK -- base case: a base case is explicitly labeled.")
    else:
        findings.append(
            "MISSING -- no clearly labeled base case found. An induction proof must "
            "explicitly verify the claim for the starting value (e.g. n = 0 or n = 1) "
            "before the inductive step; without it, there's nothing for the induction "
            "to climb from."
        )

    has_hypothesis = bool(
        re.search(r"\binductive hypothesis\b", proof, re.IGNORECASE)
        or re.search(r"\b(assume|suppose)\b[^.\n]*\b(holds|true)\b[^.\n]*\bn\s*=\s*k\b", proof, re.IGNORECASE)
        or re.search(r"\b(assume|suppose)\b[^.\n]*\bn\s*=\s*k\b", proof, re.IGNORECASE)
    )
    mentions_next = bool(re.search(r"\b(k\s*\+\s*1|n\s*\+\s*1)\b", proof, re.IGNORECASE))
    has_step_label = bool(re.search(r"\binductive step\b", proof, re.IGNORECASE))

    if has_hypothesis and mentions_next:
        findings.append(
            "OK -- inductive step: the proof states an assumption for n = k (the "
            "inductive hypothesis) and goes on to reference the n = k+1 case, the right "
            "shape for a real inductive step."
        )
    elif mentions_next and (has_step_label or True) and not has_hypothesis:
        findings.append(
            "MISSING/WARNING -- the proof reaches the n+1 (or k+1) case but never "
            "explicitly assumes the inductive hypothesis first (e.g. 'assume the claim "
            "holds for n = k'); it needs to actually invoke that assumption in the "
            "derivation, not just assert the n+1 result on its own."
        )
    else:
        findings.append(
            "MISSING -- no real inductive step found: the proof needs to explicitly "
            "assume the statement holds for some n = k (the inductive hypothesis) and "
            "then use that assumption to prove it for n = k + 1."
        )
    return findings


def _check_contradiction(proof: str) -> list[str]:
    findings = []
    has_negated_assumption = bool(
        re.search(r"for (the sake of )?contradiction", proof, re.IGNORECASE)
        or re.search(r"towards a contradiction", proof, re.IGNORECASE)
        or re.search(r"\b(suppose|assume)\b[^.\n]*\b(not|false|contrary)\b", proof, re.IGNORECASE)
    )
    if has_negated_assumption:
        findings.append("OK -- the proof clearly assumes the negation of the claim to start.")
    else:
        findings.append(
            "MISSING -- proof by contradiction needs to explicitly assume the NEGATION "
            "of the claim ('suppose, for contradiction, that ...'); that negated "
            "assumption wasn't clearly found."
        )

    lines = [ln for ln in proof.splitlines() if ln.strip()]
    contradiction_idx = next(
        (i for i, ln in enumerate(lines) if re.search(r"contradiction|contradicts|absurd|impossible", ln, re.IGNORECASE)),
        None,
    )
    if contradiction_idx is None:
        findings.append(
            "MISSING -- the proof never actually reaches a stated contradiction. "
            "Reaching a conclusion that merely seems unlikely or 'weird' is not the same "
            "as deriving two statements that cannot both be true -- check that a real "
            "logical contradiction (X and not-X, or two facts that directly conflict) "
            "was actually shown, not just implied."
        )
    elif contradiction_idx <= 1:
        findings.append(
            "WARNING -- 'contradiction' is invoked almost immediately after the "
            "assumption, with little or no derivation in between. Check that a real "
            "contradiction was actually derived from the assumption, rather than just "
            "asserted."
        )
    else:
        findings.append(
            "OK -- the proof invokes a contradiction after some derivation; still "
            "confirm by reading it that the two conflicting facts it names are "
            "genuinely incompatible, not just a coincidence-looking result."
        )
    return findings


def _check_contrapositive(claim: str, proof: str) -> list[str]:
    findings = []
    implication = _parse_implication(claim)
    if implication is None:
        findings.append(
            "WARNING -- couldn't parse the claim as a clean 'if P then Q' implication, "
            "so the contrapositive's direction can't be structurally checked here; "
            "verify by hand that the proof assumes NOT-Q and derives NOT-P."
        )
    else:
        p_text, q_text = implication
        assumption_text = _find_assumption(proof)
        if assumption_text and _has_negation(assumption_text) and _overlap_ratio(assumption_text, _keywords(q_text)) >= 0.4:
            findings.append(
                "OK -- the proof's stated assumption negates the consequent, the right "
                "start for a contrapositive proof of 'if " + p_text + " then " + q_text + "'."
            )
        else:
            shown = assumption_text if assumption_text else "<no clear assumption found>"
            findings.append(
                "MISSING/WARNING -- a genuine contrapositive proof of 'if " + p_text +
                " then " + q_text + "' must open by assuming NOT (" + q_text + "); the "
                "proof's stated assumption ('" + shown + "') doesn't clearly do that -- "
                "check it wasn't accidentally written as a direct or converse proof "
                "instead."
            )
    findings += _check_direction(claim, proof)
    return findings


def _check_cases(proof: str) -> list[str]:
    labels = sorted(set(m.group(0).lower() for m in _CASE_LABEL_RE.finditer(proof)))
    findings = [f"Found {len(labels)} labeled case(s): {', '.join(labels)}."]
    findings.append(
        "WARNING -- this tool cannot mechanically verify that these cases actually "
        "exhaust every possibility (that requires understanding the problem's domain, "
        "not text pattern-matching); explicitly check that no possibility falls outside "
        "all the stated cases. A very common real student error is covering the easy/"
        "obvious cases (e.g. only 'even' or only 'positive') and silently missing a "
        "boundary, negative, or edge case."
    )
    return findings


def _check_direct(claim: str, proof: str) -> list[str]:
    findings = [
        "No specific proof technique keyword was clearly detected (or it reads as a "
        "direct proof) -- this tool cannot mechanically verify that each sentence "
        "follows from the previous one and from given definitions; that requires "
        "actually reading the logic. Check each step by hand: does it follow from "
        "something already established (a definition, a given, or an earlier line), or "
        "is there a leap that assumes something not yet shown?"
    ]
    findings += _check_direction(claim, proof)
    return findings


# --- algebraic sub-claim extraction + real symbolic_math verification --------------

_LABEL_PREFIX_RE = re.compile(
    r"^\s*(step\s*\d+|base case|inductive step|case\s*[0-9a-z]+|assume|suppose|since|"
    r"therefore|thus|hence|so)\b[:,]?\s*",
    re.IGNORECASE,
)
_VERBAL_EQUALITY_RE = re.compile(
    r"^(.*?)\s+(?:gives|yields|simplifies to|expands to|equals|is equal to)\s+(.+)$",
    re.IGNORECASE,
)
# Descriptive lead-in phrases a proof commonly puts BEFORE the actual expression (e.g.
# "Adding k+1 to both sides gives ...", "Expanding (n+1)^2 ..."). Stripped before
# splitting so the words "adding"/"both"/"sides" never end up inside text handed to
# sympy's parser -- see _looks_purely_algebraic's docstring for why that matters.
_LEADING_OPERATION_RE = re.compile(
    r"^(?:expanding|simplifying|factoring|solving|substituting)\s+"
    r"|^(?:adding|subtracting|multiplying|dividing)\s+.+?\s+(?:to|from|by)\s+both\s+sides\s*[:,]?\s*",
    re.IGNORECASE,
)
# When a connector word ("gives"/"equals"/...) appears as prose BEFORE an actual '='
# sign on the same line (e.g. "...gives k(k+1)/2 + (k+1) = (k+1)(k+2)/2"), only the text
# after the connector is the real equation -- everything before it is a description of
# the step, not part of the algebra.
_CONNECTOR_WORDS_RE = re.compile(
    r"\b(?:gives|yields|simplifies to|expands to|equals|is equal to)\b", re.IGNORECASE
)
_MAX_ALGEBRA_LINES = 20

_ALLOWED_MATH_WORDS = {"sin", "cos", "tan", "log", "ln", "sqrt", "exp", "pi"}
_MATH_CHARS_RE = re.compile(r"^[0-9A-Za-z+\-*/^().,\s]+$")
_ALPHA_WORD_RE = re.compile(r"[A-Za-z]+")


def _looks_purely_algebraic(text: str) -> bool:
    """A stricter gate than check_work's `_looks_like_math`, run just before handing
    text to sympy's parser. check_work.py's own comment notes that sympy's implicit-
    multiplication parser will happily "parse" plain English as a product of one-letter
    symbols (e.g. "the king was mean" -> t*h*e*k*i*n*g...) -- an acceptable risk for
    check_work's single, already instruction-stripped final-answer line, but here the
    text comes from the MIDDLE of free-form proof prose, where a leftover descriptive
    word is far more likely to survive extraction. This additionally rejects any
    alphabetic run of 3+ letters that isn't a recognized math function name, so a
    mis-extracted sentence can never produce a false "VERIFIED WRONG" -- a genuinely
    misleading result -- off garbage symbol products instead of a real equation."""
    if not _looks_like_math(text):
        return False
    if not _MATH_CHARS_RE.match(text):
        return False
    return all(len(w) < 3 or w.lower() in _ALLOWED_MATH_WORDS for w in _ALPHA_WORD_RE.findall(text))


def _extract_equation_pairs(proof: str) -> list[tuple[str, str, str]]:
    """Returns (original_line, lhs_text, rhs_text) for each candidate equation-shaped
    fragment in the proof -- a chained equality like 'a = b = c' yields one pair per
    adjacent link (a,b) and (b,c), so a broken link can be pinpointed exactly rather
    than only knowing the whole chain is wrong somewhere. Strips common proof-prose
    labels/lead-ins first (Step 2:, Base case:, Adding X to both sides, ...) so those
    words don't end up inside the expression sympy is asked to parse."""
    pairs: list[tuple[str, str, str]] = []
    for raw in proof.splitlines():
        stripped = raw.strip()
        if not stripped:
            continue
        cleaned = _LABEL_PREFIX_RE.sub("", stripped).strip()
        if not cleaned:
            continue
        if "=>" in cleaned or "<=>" in cleaned or "!=" in cleaned:
            continue
        cleaned = _LEADING_OPERATION_RE.sub("", cleaned).strip()
        if not cleaned:
            continue
        if "=" in cleaned:
            eq_pos = cleaned.find("=")
            prefix = cleaned[:eq_pos]
            connector_hits = list(_CONNECTOR_WORDS_RE.finditer(prefix))
            if connector_hits:
                cleaned = cleaned[connector_hits[-1].end():].strip()
            parts = [p.strip(" .,") for p in cleaned.split("=")]
            for left, right in zip(parts, parts[1:]):
                if left and right:
                    pairs.append((stripped, left, right))
        else:
            m = _VERBAL_EQUALITY_RE.match(cleaned)
            if m:
                left, right = m.group(1).strip(" .,"), m.group(2).strip(" .,")
                if left and right:
                    pairs.append((stripped, left, right))
        if len(pairs) >= _MAX_ALGEBRA_LINES:
            break
    return pairs[:_MAX_ALGEBRA_LINES]


def _verify_algebraic_claims(proof: str) -> list[str]:
    """Reuses symbolic_math's own `_parse` directly (the same convention check_work.py
    already follows) -- never a hand-rolled parser. A parse/compute failure on a given
    fragment just means "not a checkable algebraic claim", never an error surfaced to
    the caller, matching check_work.py's own never-raises philosophy."""
    entries: list[str] = []
    for original, lhs_text, rhs_text in _extract_equation_pairs(proof):
        if not (_looks_purely_algebraic(lhs_text) and _looks_purely_algebraic(rhs_text)):
            continue
        try:
            lhs_expr = _parse(lhs_text)
            rhs_expr = _parse(rhs_text)
            diff = sympy.simplify(lhs_expr - rhs_expr)
        except Exception:
            continue
        if diff == 0:
            entries.append(
                f"VERIFIED CORRECT (real symbolic math): '{lhs_text}' = '{rhs_text}' "
                f'really does hold (from: "{original}").'
            )
        else:
            lhs_expanded = sympy.expand(lhs_expr)
            rhs_expanded = sympy.expand(rhs_expr)
            entries.append(
                f"VERIFIED WRONG (real symbolic math): '{lhs_text}' expands to "
                f"{lhs_expanded}, but '{rhs_text}' expands to {rhs_expanded} -- these "
                f'are NOT equal (from: "{original}"). This step contains a genuine '
                "computational error, not just a stylistic issue."
            )
    return entries


_FALLACY_CHECKLIST = (
    "Beyond the structural checks above, explicitly check the proof against this "
    "fallacy checklist and name any that apply, quoting the exact sentence responsible "
    "(this is careful reasoning, not something computed):\n"
    "- Circular reasoning: does any step assume the very thing being proven (or "
    "something equivalent to it) as if it were already established?\n"
    "- Affirming the consequent: does it go from 'if P then Q' and 'Q is true' to "
    "'therefore P', without a valid biconditional? (see the direction check above)\n"
    "- Proving the converse: does it end up establishing 'if Q then P' instead of the "
    "stated 'if P then Q'? (see the direction check above)\n"
    "- Existential claim 'proven' by one example: if the claim is universal ('for "
    "all'/'every'), is it actually shown for an arbitrary/general case, or just checked "
    "for one specific number?\n"
    "- Swapped quantifier order: if the claim is '(for all x)(there exists y)', does "
    "the proof accidentally pick y BEFORE x is given, i.e. prove the different, "
    "stronger claim '(there exists y)(for all x)'?"
)


def _format_algebra_section(entries: list[str]) -> str:
    if not entries:
        return (
            "No algebraic/computational sub-steps could be extracted and checked in "
            "this proof (or the proof contains none) -- nothing in this proof was "
            "verified by symbolic computation; the entire critique below is reasoning-"
            "based."
        )
    return "\n".join(f"- {e}" for e in entries)


class CheckProofWorkTool(Tool):
    """Structured critique of a student's own WRITTEN PROOF -- the proof counterpart of
    check_student_work. There is no natural-deduction engine backing general logical
    validity (unlike check_student_work's six SymPy operations), so this tool is
    explicit, in its own returned text, about a hard split: any real algebraic/
    computational sub-claim inside the proof (an equation, an expansion) is extracted
    and VERIFIED for real via symbolic_math's own parser; the surrounding logical
    structure (technique-specific requirements, direction of implication, a fallacy
    checklist) is a careful, structured REASONING-based critique that the tool states
    plainly is not computationally verified."""

    name = "check_proof_work"
    description = (
        "Checks a student's own WRITTEN PROOF (induction, contradiction, "
        "contrapositive, case analysis, or direct) and returns a structured critique: "
        "any real algebraic sub-step inside it (an equation, an expansion) is verified "
        "for real via symbolic math; the surrounding logical structure is a careful, "
        "explicitly-labeled reasoning-based critique (base case/inductive step present, "
        "contradiction actually derived, direction not silently reversed into the "
        "converse, cases actually exhaustive, plus a named fallacy checklist) -- NOT a "
        "computational certainty, since no algorithm decides general logical validity. "
        "Call when a student shares their own proof attempt and asks if it's right or "
        "wants feedback."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "claim": {
                "type": "string",
                "description": "The statement/theorem the student is trying to prove.",
            },
            "proof": {
                "type": "string",
                "description": "The student's own written proof text, in full.",
            },
        },
        "required": ["claim", "proof"],
    }

    async def run(self, claim: str, proof: str) -> str:
        if not claim or not claim.strip():
            return "Error: claim must not be empty."
        if not proof or not proof.strip():
            return "Error: proof must not be empty."

        technique = _detect_technique(proof)
        algebra_entries = _verify_algebraic_claims(proof)

        if technique == "induction":
            structural = _check_induction(proof)
        elif technique == "contradiction":
            structural = _check_contradiction(proof)
        elif technique == "contrapositive":
            structural = _check_contrapositive(claim, proof)
        elif technique == "cases":
            structural = _check_cases(proof)
        else:
            structural = _check_direct(claim, proof)

        structural += _check_quantifiers(claim, proof)

        header = (
            "PROOF CRITIQUE.\n\n"
            "1) COMPUTATIONALLY VERIFIED (real symbolic math -- SymPy, not a guess):\n"
        )
        algebra_section = _format_algebra_section(algebra_entries)

        structural_header = (
            "\n\n2) STRUCTURAL / LOGICAL CRITIQUE -- this is a careful, structured "
            "REASONING-BASED judgment, NOT a computational verification. There is no "
            f"algorithm that decides general logical validity. Detected technique: "
            f"{technique}. Treat the findings below as expert critique to confirm and "
            "build on, never as ground truth the way section 1 above is:\n"
        )
        structural_section = "\n".join(f"- {f}" for f in structural)

        footer = (
            "\n\n3) FALLACY CHECKLIST (careful reasoning, not computed):\n" + _FALLACY_CHECKLIST +
            "\n\nWhen you respond to the student: state PLAINLY which parts above were "
            "computationally verified (the algebra in section 1, if any) and which "
            "parts are your careful structural/logical judgment (sections 2 and 3) -- "
            "do not blur the two together or paraphrase the distinction away. Then give "
            "a specific verdict that names the exact sentence or step with a problem, "
            "quoting it directly, rather than a vague 'looks okay' or 'has issues.'\n\n"
            f"Claim being proven: {claim}\n\nStudent's proof:\n{proof}"
        )

        return header + algebra_section + structural_header + structural_section + footer
