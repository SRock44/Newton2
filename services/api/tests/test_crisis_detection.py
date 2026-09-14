"""Tests for app/core/crisis_detection.py's baseline crisis-response safety net
(ROADMAP.md Phase 7). Pure, no-DB/no-network unit tests against the pattern-matching
mechanism itself -- see tests/test_chat_websocket_crisis.py for the WS-handler
integration (persistence/streaming, provider never invoked, logging behavior).

Both directions matter equally here: false negatives on real crisis language are a
safety failure, but false positives on ordinary academic content would make the tutor
unusable for entire subjects (history, literature, biology). Every true-negative case
below is a sentence that plausibly appears in real schoolwork.
"""

import logging

import pytest

from app.core import crisis_detection


TRUE_POSITIVES = [
    "i want to kill myself",
    "I want to kill myself.",
    "i'm going to kill myself",
    "Im gonna kill myself tonight",
    "i am going to kill myself",
    "i'm seriously thinking about killing myself",
    "i don't want to be alive anymore",
    "i dont want to live anymore",
    "I don't want to exist anymore",
    "i want to end my life",
    "i'm planning to end it all",
    "I am going to end my life tonight",
    "i am thinking about suicide",
    "I'm thinking of suicide",
    "i'm suicidal",
    "I am suicidal",
    "i want to commit suicide",
    "i wanted to attempt suicide",
    "i want to hurt myself",
    "i want to cut myself",
    "i'm going to harm myself",
    "i plan to cut myself tonight",
    "i wish i was dead",
    "I wish I were dead",
    "i wish i was never born",
    "i'd be better off dead",
    "everyone would be better off without me",
]

TRUE_NEGATIVES = [
    "Can you help me understand why Romeo and Juliet both die at the end?",
    "What caused the wave of suicides described in this sociology reading?",
    "Explain apoptosis (programmed cell death) in this biology unit",
    "Write an essay about the themes of mortality in this poem.",
    "My essay is about a character in the novel who wants to kill the king.",
    "The article discusses why some teens want to hurt themselves as a coping mechanism.",
    "I'm dying to know the answer to this math problem.",
    "This homework is going to kill me, can you help me finish it?",
    "I want to understand suicide rates in this country for my sociology report.",
    "He said in the novel that he wants to kill himself, can we discuss that theme?",
    "I have to write about death and dying in Victorian literature.",
    "Can you help me with a chemistry question about cell death pathways?",
    "I'm struggling with this exam, i could just die of stress.",
    "What is the suicide rate among teenagers according to this CDC dataset?",
    "Kill, suicide, die, death, and hurt are all words in this vocabulary quiz.",
    "Can you help me understand the causes of death in this historical famine?",
    "The soldier in this WWI poem describes wanting the war to end.",
    "My biology homework asks me to explain programmed cell death.",
    "In the play, the character says 'I want to end my speech here.'",
    "This chapter discusses cell death and its role in cancer biology.",
]


@pytest.mark.parametrize("text", TRUE_POSITIVES)
def test_detects_crisis_true_positives(text):
    assert crisis_detection.detects_crisis(text) is True, f"expected a detection for: {text!r}"
    assert crisis_detection.classify_crisis(text) is not None


@pytest.mark.parametrize("text", TRUE_NEGATIVES)
def test_detects_crisis_true_negatives(text):
    assert crisis_detection.detects_crisis(text) is False, f"unexpected false positive for: {text!r}"
    assert crisis_detection.classify_crisis(text) is None


def test_detects_crisis_is_case_insensitive():
    assert crisis_detection.detects_crisis("I WANT TO KILL MYSELF") is True


def test_detects_crisis_handles_empty_and_none_like_input():
    assert crisis_detection.detects_crisis("") is False
    assert crisis_detection.classify_crisis("") is None


def test_detects_crisis_fails_safe_on_internal_error(monkeypatch, caplog):
    """Per the spec's explicit fail-safe requirement: an internal error in matching must
    never crash the caller (chat_ws) and must never be silently swallowed either -- it's
    treated as "not detected" AND logged at ERROR level so a broken detector stays
    visible."""

    class _ExplodingPattern:
        def search(self, _text):
            raise RuntimeError("simulated internal detector failure")

    monkeypatch.setattr(
        crisis_detection,
        "_CRISIS_PATTERNS",
        (("boom", _ExplodingPattern()),),
    )

    with caplog.at_level(logging.ERROR, logger="newton.crisis_detection"):
        result = crisis_detection.detects_crisis("i want to kill myself")

    assert result is False  # fails toward the safe side, never raises
    assert any(
        r.levelno == logging.ERROR and "crisis_detection internal error" in r.message
        for r in caplog.records
    )


def test_crisis_response_text_contains_verified_resources():
    text = crisis_detection.CRISIS_RESPONSE_TEXT
    assert "988" in text
    assert "741741" in text
    assert "HOME" in text
    assert "911" in text
