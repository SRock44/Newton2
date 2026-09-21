"""Real tests for app.services.citation_grounding -- pure functions, no I/O, no model
calls (same tier as tests/test_bibliography.py). `_SOURCE_TEXT` below is the fixture used
to pick GROUNDING_THRESHOLD (see that module's own docstring): a real short passage, a
real paraphrase of it, a real near-verbatim quote of it, and two realistic fabricated
claims about the same general topic but never actually stated in the passage.
"""

from app.services.citation_grounding import (
    GROUNDING_THRESHOLD,
    _containment_score,
    check_section_grounding,
    extract_citing_claims,
)

# A real, self-contained passage standing in for a research_fetch'd page's real text --
# deliberately written in the register real fetched arxiv/PLOS/Wikipedia prose has.
_SOURCE_TEXT = (
    "Global installed solar photovoltaic capacity reached approximately 1,600 gigawatts "
    "by the end of 2023, roughly quadrupling over the preceding six years. Falling module "
    "prices, supportive government policies, and improved storage technology have driven "
    "this rapid expansion, particularly in China, the United States, and the European "
    "Union. Analysts project continued double-digit annual growth through the end of the "
    "decade as utility-scale and rooftop installations both accelerate."
)

# A genuine paraphrase of the passage -- should be graded grounded.
_GROUNDED_PARAPHRASE = (
    "Solar power capacity worldwide has grown rapidly, quadrupling in six years to reach "
    "about 1,600 gigawatts by 2023, driven by cheaper panels and strong policy support."
)

# A near-verbatim quote -- should be graded grounded, and by a wide margin.
_GROUNDED_NEAR_VERBATIM = (
    "Global installed solar photovoltaic capacity reached approximately 1,600 gigawatts "
    "by the end of 2023, roughly quadrupling over the preceding six years."
)

# Real claim, same general subject area (solar power), but nothing the passage above
# actually states -- the exact "real source, wrong/invented attribution" case this
# feature exists to catch.
_FABRICATED_SAME_TOPIC = (
    "Solar panels were first invented in 1839 by Edmond Becquerel and now account for "
    "over half of all residential rooftops in Germany."
)
_FABRICATED_SPECIFIC_STAT = (
    "Solar power now supplies 78 percent of global electricity demand, according to "
    "recent industry figures, making it the dominant source of energy worldwide."
)

# Nothing at all to do with the passage.
_UNRELATED_CLAIM = (
    "Deep-sea coral reefs near Antarctica have been found to host previously unknown "
    "species of bioluminescent fish, according to a recent marine biology survey."
)


# ---------------------------------------------------------------------------
# GROUNDING_THRESHOLD actually separates real grounded claims from real fabricated ones
# ---------------------------------------------------------------------------


def test_grounded_paraphrase_clears_the_threshold():
    score = _containment_score(_GROUNDED_PARAPHRASE, _SOURCE_TEXT)
    assert score >= GROUNDING_THRESHOLD, score


def test_grounded_near_verbatim_quote_clears_the_threshold_by_a_wide_margin():
    score = _containment_score(_GROUNDED_NEAR_VERBATIM, _SOURCE_TEXT)
    assert score >= GROUNDING_THRESHOLD
    assert score > 0.6, score  # a near-quote should score far above the bar, not barely pass


def test_fabricated_same_topic_claim_fails_the_threshold():
    score = _containment_score(_FABRICATED_SAME_TOPIC, _SOURCE_TEXT)
    assert score < GROUNDING_THRESHOLD, score


def test_fabricated_specific_statistic_fails_the_threshold():
    score = _containment_score(_FABRICATED_SPECIFIC_STAT, _SOURCE_TEXT)
    assert score < GROUNDING_THRESHOLD, score


def test_unrelated_claim_scores_zero():
    assert _containment_score(_UNRELATED_CLAIM, _SOURCE_TEXT) == 0.0


def test_threshold_has_real_margin_on_both_sides_of_the_gap():
    """The actual number GROUNDING_THRESHOLD was set to (see the module docstring) sits
    strictly between the lowest real grounded score and the highest real fabricated
    score observed across this fixture set -- not just barely on the correct side."""
    grounded_scores = [
        _containment_score(_GROUNDED_PARAPHRASE, _SOURCE_TEXT),
        _containment_score(_GROUNDED_NEAR_VERBATIM, _SOURCE_TEXT),
    ]
    fabricated_scores = [
        _containment_score(_FABRICATED_SAME_TOPIC, _SOURCE_TEXT),
        _containment_score(_FABRICATED_SPECIFIC_STAT, _SOURCE_TEXT),
        _containment_score(_UNRELATED_CLAIM, _SOURCE_TEXT),
    ]
    assert min(grounded_scores) > max(fabricated_scores)
    assert min(grounded_scores) > GROUNDING_THRESHOLD > max(fabricated_scores)


def test_empty_claim_scores_zero_not_a_crash():
    assert _containment_score("", _SOURCE_TEXT) == 0.0
    assert _containment_score("the a of to", _SOURCE_TEXT) == 0.0  # all stopwords


# ---------------------------------------------------------------------------
# extract_citing_claims -- pure sentence/citation extraction
# ---------------------------------------------------------------------------


def test_extract_citing_claims_maps_key_to_its_sentence_without_the_cite_command():
    prose = "Solar power is booming \\cite{doe2024}. It has nothing to do with tea."
    claims = extract_citing_claims(prose)
    assert claims == {"doe2024": "Solar power is booming ."}


def test_extract_citing_claims_handles_multiple_keys_in_one_cite():
    prose = "Two things are true \\cite{a,b}."
    claims = extract_citing_claims(prose)
    assert claims["a"] == claims["b"] == "Two things are true ."


def test_extract_citing_claims_joins_multiple_sentences_citing_the_same_key():
    prose = "First fact \\cite{k}. Second fact about the same thing \\cite{k}."
    claims = extract_citing_claims(prose)
    assert "First fact" in claims["k"]
    assert "Second fact" in claims["k"]


def test_extract_citing_claims_ignores_sentences_with_no_citation():
    prose = "Just a plain sentence with no citation at all."
    assert extract_citing_claims(prose) == {}


def test_extract_citing_claims_handles_optional_bracket_argument():
    prose = "A page-specific claim \\cite[42]{k}."
    claims = extract_citing_claims(prose)
    assert claims["k"] == "A page-specific claim ."


# ---------------------------------------------------------------------------
# check_section_grounding -- the real per-section entry point
# ---------------------------------------------------------------------------


def _source(key: str, url: str) -> dict:
    return {"key": key, "type": "misc", "title": "T", "url": url}


def test_check_section_grounding_marks_a_genuinely_supported_citation_as_grounded():
    # Realistic model output puts \cite{} BEFORE the sentence's own terminal period (as
    # SECTION_DRAFT_PROMPT asks for -- "add an inline \cite{key} placeholder immediately
    # after" the claim, e.g. "...policy support \cite{s1}."), not after it.
    prose = f"{_GROUNDED_PARAPHRASE[:-1]} \\cite{{s1}}."
    sources = [_source("s1", "https://arxiv.org/abs/1")]
    url_fetched_text = {"https://arxiv.org/abs/1": _SOURCE_TEXT}

    results = check_section_grounding(prose, sources, url_fetched_text)

    assert len(results) == 1
    assert results[0].key == "s1"
    assert results[0].status == "grounded"
    assert results[0].score >= GROUNDING_THRESHOLD


def test_check_section_grounding_marks_a_fabricated_claim_against_a_real_source_as_ungrounded():
    prose = f"{_FABRICATED_SAME_TOPIC[:-1]} \\cite{{s1}}."
    sources = [_source("s1", "https://arxiv.org/abs/1")]
    url_fetched_text = {"https://arxiv.org/abs/1": _SOURCE_TEXT}

    results = check_section_grounding(prose, sources, url_fetched_text)

    assert results[0].status == "ungrounded"
    assert results[0].score is not None
    assert results[0].score < GROUNDING_THRESHOLD


def test_check_section_grounding_marks_a_never_fetched_source_as_not_fetched():
    """The model cited a URL with real-looking metadata, but this section never actually
    fetched it -- a different, worse case than "fetched but unclear" (see the module
    docstring): there's no real page text at all to check the claim against."""
    prose = f"{_GROUNDED_PARAPHRASE[:-1]} \\cite{{s1}}."
    sources = [_source("s1", "https://arxiv.org/abs/never-fetched")]
    url_fetched_text: dict[str, str] = {}

    results = check_section_grounding(prose, sources, url_fetched_text)

    assert results[0].status == "not_fetched"
    assert results[0].score is None


def test_check_section_grounding_marks_a_source_with_no_url_as_not_fetched():
    prose = "The student's own document says so \\cite{s1}."
    sources = [{"key": "s1", "title": "No URL source"}]

    results = check_section_grounding(prose, sources, {})

    assert results[0].status == "not_fetched"


def test_check_section_grounding_matches_urls_case_and_whitespace_insensitively():
    prose = f"{_GROUNDED_PARAPHRASE[:-1]} \\cite{{s1}}."
    sources = [_source("s1", "  HTTPS://ARXIV.ORG/abs/1  ")]
    url_fetched_text = {"https://arxiv.org/abs/1": _SOURCE_TEXT}

    results = check_section_grounding(prose, sources, url_fetched_text)

    assert results[0].status == "grounded"


def test_check_section_grounding_skips_sources_with_no_key():
    results = check_section_grounding("text \\cite{s1}", [{"title": "no key"}], {})
    assert results == []


def test_check_section_grounding_handles_multiple_sources_independently():
    prose = (
        f"{_GROUNDED_PARAPHRASE[:-1]} \\cite{{good}}. "
        f"{_FABRICATED_SAME_TOPIC[:-1]} \\cite{{bad}}. "
        "A third claim citing an unfetched source \\cite{missing}."
    )
    sources = [
        _source("good", "https://arxiv.org/abs/1"),
        _source("bad", "https://arxiv.org/abs/1"),
        _source("missing", "https://arxiv.org/abs/999"),
    ]
    url_fetched_text = {"https://arxiv.org/abs/1": _SOURCE_TEXT}

    results = {r.key: r for r in check_section_grounding(prose, sources, url_fetched_text)}

    assert results["good"].status == "grounded"
    assert results["bad"].status == "ungrounded"
    assert results["missing"].status == "not_fetched"
