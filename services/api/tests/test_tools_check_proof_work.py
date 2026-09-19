from app.tools.check_proof_work import CheckProofWorkTool

_SUM_CLAIM = "For all positive integers n, 1 + 2 + ... + n = n(n+1)/2."

_VALID_INDUCTION_PROOF = (
    "We prove this by induction on n.\n\n"
    "Base case: for n = 1, the left side is 1 and the right side is 1(1+1)/2, which is "
    "1. They match.\n\n"
    "Inductive step: assume the claim holds for n = k, that is 1 + 2 + ... + k = "
    "k(k+1)/2.\n"
    "We want to show it holds for n = k+1.\n"
    "Adding k+1 to both sides gives 1 + 2 + ... + k + (k+1) = k(k+1)/2 + (k+1).\n"
    "k(k+1)/2 + (k+1) = (k+1)(k+2)/2\n"
    "So the claim holds for n = k+1.\n\n"
    "Therefore, by induction, the claim holds for all positive integers n."
)

_INDUCTION_MISSING_BASE_CASE_PROOF = (
    "We prove this by induction on n.\n\n"
    "Inductive step: assume the claim holds for n = k, that is 1 + 2 + ... + k = "
    "k(k+1)/2.\n"
    "Adding k+1 to both sides gives k(k+1)/2 + (k+1) = (k+1)(k+2)/2.\n"
    "So the claim holds for n = k+1.\n\n"
    "Therefore, by induction, the claim holds for all positive integers n."
)

_WEAK_CONTRADICTION_CLAIM = "There is no largest prime number."
_WEAK_CONTRADICTION_PROOF = (
    "Suppose, for contradiction, that there is a largest prime number, call it p.\n"
    "This seems very unlikely since primes go on forever.\n"
    "This is a contradiction. Therefore there is no largest prime."
)

_CONVERSE_CLAIM = "If n is even, then n^2 is even."
_CONVERSE_PROOF = (
    "We will prove the contrapositive.\n"
    "Assume n is even.\n"
    "Then n = 2k for some integer k, so n^2 = 4k^2 = 2(2k^2).\n"
    "Therefore n^2 is even."
)

_WRONG_ALGEBRA_CLAIM = "For all integers n, (n+1)^2 = n^2 + 2n + 1."
_WRONG_ALGEBRA_PROOF = (
    "We compute directly.\n"
    "Expanding (n+1)^2 gives n^2 + 2n + 2.\n"
    "Therefore (n+1)^2 = n^2 + 2n + 1 as required."
)

_DIRECT_CLAIM = "If n and m are both even integers, then n + m is even."
_CORRECT_DIRECT_PROOF = (
    "Assume n and m are both even integers.\n"
    "Then n = 2a and m = 2b for some integers a and b.\n"
    "n + m = 2a + 2b = 2(a + b).\n"
    "Since a + b is an integer, n + m is even.\n"
    "Therefore, n + m is even."
)


def _assert_honest_split(result: str) -> None:
    """Every response must explicitly, visibly distinguish computed from reasoned --
    not just internally, in the response text itself (ROADMAP's 'verified, not vibes
    is invisible to the student' finding, applied here before it can happen)."""
    assert "COMPUTATIONALLY VERIFIED" in result
    assert "STRUCTURAL / LOGICAL CRITIQUE" in result
    assert "NOT a computational verification" in result
    assert "state PLAINLY which parts above were" in result


async def test_valid_induction_proof_passes_structural_checks_cleanly():
    tool = CheckProofWorkTool()
    result = await tool.run(claim=_SUM_CLAIM, proof=_VALID_INDUCTION_PROOF)
    assert "Detected technique: induction" in result
    assert "OK -- base case" in result
    assert "OK -- inductive step" in result
    assert "MISSING" not in result
    assert "FLAGGED" not in result
    # the one real algebraic sub-step in this proof is genuinely correct and should be
    # reported as actually verified, not asserted
    assert "VERIFIED CORRECT" in result
    assert "VERIFIED WRONG" not in result
    _assert_honest_split(result)


async def test_induction_missing_base_case_is_caught_specifically():
    tool = CheckProofWorkTool()
    result = await tool.run(claim=_SUM_CLAIM, proof=_INDUCTION_MISSING_BASE_CASE_PROOF)
    assert "MISSING -- no clearly labeled base case" in result
    # the inductive step itself is fine and the real algebra in it is correct -- only
    # the base case should be flagged, not everything
    assert "OK -- inductive step" in result
    assert "VERIFIED WRONG" not in result
    _assert_honest_split(result)


async def test_contradiction_without_a_real_contradiction_is_caught():
    tool = CheckProofWorkTool()
    result = await tool.run(claim=_WEAK_CONTRADICTION_CLAIM, proof=_WEAK_CONTRADICTION_PROOF)
    assert "Detected technique: contradiction" in result
    assert "OK -- the proof clearly assumes the negation" in result
    # 'contradiction' is invoked right after the assumption with no real derivation --
    # must be caught as weak/unsupported, not accepted as a real contradiction
    assert "WARNING" in result and "little or no derivation" in result
    _assert_honest_split(result)


async def test_proof_of_the_converse_is_caught():
    tool = CheckProofWorkTool()
    result = await tool.run(claim=_CONVERSE_CLAIM, proof=_CONVERSE_PROOF)
    assert "FLAGGED" in result
    assert "CONVERSE" in result
    assert "n is even" in result and "n^2 is even" in result
    # the real algebraic sub-step (4k^2 = 2(2k^2)) is correct and should still be
    # reported as genuinely verified even though the logical structure is flawed
    assert "VERIFIED CORRECT" in result
    _assert_honest_split(result)


async def test_wrong_algebraic_substep_is_caught_via_real_symbolic_math():
    tool = CheckProofWorkTool()
    result = await tool.run(claim=_WRONG_ALGEBRA_CLAIM, proof=_WRONG_ALGEBRA_PROOF)
    assert "VERIFIED WRONG" in result
    # the real, correctly computed expansion must be present, not just an assertion
    assert "n**2 + 2*n + 1" in result
    assert "n**2 + 2*n + 2" in result
    _assert_honest_split(result)


async def test_correct_direct_proof_passes():
    tool = CheckProofWorkTool()
    result = await tool.run(claim=_DIRECT_CLAIM, proof=_CORRECT_DIRECT_PROOF)
    assert "Detected technique: direct" in result
    assert "MISSING" not in result
    assert "FLAGGED" not in result
    assert "VERIFIED WRONG" not in result
    assert "VERIFIED CORRECT" in result
    _assert_honest_split(result)


async def test_empty_claim_is_a_clear_error():
    tool = CheckProofWorkTool()
    result = await tool.run(claim="   ", proof="Assume n = 1.")
    assert result.startswith("Error:")


async def test_empty_proof_is_a_clear_error():
    tool = CheckProofWorkTool()
    result = await tool.run(claim="If n is even, then n^2 is even.", proof="")
    assert result.startswith("Error:")


async def test_registered_with_name_and_required_params():
    tool = CheckProofWorkTool()
    assert tool.name == "check_proof_work"
    assert set(tool.parameters["required"]) == {"claim", "proof"}


async def test_no_algebra_found_is_stated_honestly_not_silently_skipped():
    tool = CheckProofWorkTool()
    result = await tool.run(
        claim="There is no largest prime number.",
        proof=(
            "Suppose, for contradiction, that there are finitely many primes "
            "p1, ..., pn.\n"
            "Let N be one more than their product.\n"
            "N is not divisible by any of p1 through pn, so N has a prime factor not "
            "in the list.\n"
            "This contradicts the assumption that p1, ..., pn were all the primes."
        ),
    )
    assert "No algebraic/computational sub-steps could be extracted" in result
