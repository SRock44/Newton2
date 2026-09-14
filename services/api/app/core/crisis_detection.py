"""Baseline crisis-detection safety net: a deterministic, local pattern match for clear,
direct first-person statements of suicidal ideation or self-harm intent -- see
ROADMAP.md Phase 7 and app/routers/chat.py's WebSocket handler, the only caller.

Deliberately NOT an LLM call: this runs on every single chat turn, so it has to add
zero meaningful latency and zero token cost to the overwhelming majority of ordinary
messages that have nothing to do with this. Same reason it's deliberately narrow: this
is a baseline safety net for direct, unambiguous statements, not a clinical mental-health
classifier and not a general "abuse/violence" detector (a separate, explicitly
out-of-scope future piece with its own resource list -- see ROADMAP.md).

Design, same spirit as app/tools/research_fetch.py's domain allowlist: a short, hand-
curated, easily-auditable list a maintainer reads and extends directly in this file --
nothing about it is dynamic, configurable by the model, or influenced by request
parameters. Patterns match PHRASES with clear first-person intent, never bare keywords:
"suicide", "kill", "die", "death", and "hurt" all appear constantly in ordinary
schoolwork (history, literature, biology -- a Romeo and Juliet question, a sociology
reading about a wave of suicides, a biology unit on apoptosis/programmed cell death, an
essay on mortality as a theme) and a naive substring match would make the tutor
unusable. Every pattern here requires a first-person subject ("i") plus a clear verb of
intent, not just a topic word appearing anywhere in the sentence.

Failure mode, per this module's own design requirement: if matching ever raises for any
reason, `detects_crisis` fails toward the SAFE side (treats it as "not detected" so the
chat turn never crashes) but logs the error at ERROR level so a silent detector failure
is never invisible -- a crashed chat turn helps no one, but a silently-broken detector
is worse than an occasional missed edge case.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger("newton.crisis_detection")

# --- The fixed crisis response ------------------------------------------------------
# Sent VERBATIM in place of a normal tutor reply for the triggering turn -- never
# generated or paraphrased by the LLM. Resource details (988, Crisis Text Line's
# "text HOME to 741741") verified current as of 2026-09-13.
CRISIS_RESPONSE_TEXT = (
    "I want to pause here because what you're describing sounds really serious, and "
    "your safety matters more than anything else right now. I'm an AI tutor — I'm not "
    "equipped to help with this the way a real person can, but real support is "
    "available right now, for free, 24/7:\n"
    "\n"
    "- **US**: Call or text 988 (Suicide & Crisis Lifeline), or text HOME to 741741 "
    "(Crisis Text Line)\n"
    "- **Outside the US**: Please contact your local emergency services or search "
    '"[your country] crisis line"\n'
    "\n"
    "If you're in immediate danger, please call emergency services (911 in the US) "
    "right now.\n"
    "\n"
    "You don't have to go through this alone, and reaching out for help is a sign of "
    "strength, not weakness. I'll be here if you want to talk about schoolwork again "
    "later."
)

# --- Detection patterns --------------------------------------------------------------
# Each entry is (category, compiled pattern). Categories exist only to make a WARNING
# log line and this file itself easier to audit -- they carry no other behavior.
# Every pattern requires an explicit first-person subject ("i"/"i'm"/"i've"/etc.)
# directly attached to a clear verb of intent, not a bare topic word. Apostrophes are
# made optional (`'?`) so both "don't" and "dont" match, since chat input is casual,
# unedited text.
_CRISIS_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "kill_myself",
        re.compile(
            r"\bi\s*(?:'?m|'?ll| am| will)?\s*"
            r"(?:really\s+|seriously\s+|just\s+|honestly\s+)?"
            r"(?:going to|gonna|want(?:ed)?\s+to|wanna|plan(?:ning)?\s+to|about to|"
            r"thinking (?:about|of)|trying to)\s+kill(?:ing)?\s+myself\b",
            re.IGNORECASE,
        ),
    ),
    (
        "end_my_life",
        re.compile(
            r"\bi\s*(?:'?m|'?ll| am| will)?\s*"
            r"(?:really\s+|seriously\s+|just\s+)?"
            r"(?:going to|gonna|want(?:ed)?\s+to|wanna|plan(?:ning)?\s+to|about to|"
            r"thinking (?:about|of))\s+end(?:ing)?\s+(?:my\s+(?:own\s+)?life|it all)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "self_harm_intent",
        re.compile(
            r"\bi\s*(?:'?m|'?ll| am| will)?\s*"
            r"(?:really\s+|seriously\s+|just\s+)?"
            r"(?:going to|gonna|want(?:ed)?\s+to|wanna|plan(?:ning)?\s+to|about to|"
            r"thinking (?:about|of))\s+(?:hurt(?:ing)?|cut(?:ting)?|harm(?:ing)?)\s+myself\b",
            re.IGNORECASE,
        ),
    ),
    (
        "suicidal_self_description",
        re.compile(
            r"\bi\s*(?:'?m| am)\s+suicidal\b",
            re.IGNORECASE,
        ),
    ),
    (
        "suicide_first_person_intent",
        re.compile(
            r"\bi\s*(?:'?m|'?ll| am| will)?\s*"
            r"(?:really\s+|seriously\s+|just\s+)?"
            r"(?:thinking (?:about|of)|considering|planning|going to|about to)\s+"
            r"(?:committing\s+)?suicide\b"
            r"|\bi\s+want(?:ed)?\s+to\s+(?:commit|attempt)\s+suicide\b",
            re.IGNORECASE,
        ),
    ),
    (
        "dont_want_to_be_alive",
        re.compile(
            r"\bi\s+do\s*n'?t\s+want\s+to\s+(?:be\s+alive|live|exist)\s+anymore\b",
            re.IGNORECASE,
        ),
    ),
    (
        "wish_i_was_dead",
        re.compile(
            r"\bi\s+wish\s+i\s*(?:'?d| had)?\s*(?:was|were)\s+(?:dead|never\s+born)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "better_off_dead",
        re.compile(
            r"\bi\s*(?:'?d| would)\s+be\s+better\s+off\s+dead\b"
            r"|\beveryone\s+(?:would\s+be|is)\s+better\s+off\s+without\s+me\b",
            re.IGNORECASE,
        ),
    ),
)


def _normalize(text: str) -> str:
    """Lowercase and fold typographic quotes to a straight apostrophe so patterns don't
    need to separately spell out curly-quote variants."""
    return text.lower().replace("’", "'").replace("‘", "'")


def classify_crisis(text: str) -> str | None:
    """Returns the matched category name if `text` contains a direct, first-person
    expression of suicidal ideation or self-harm intent, else None. Pure and
    side-effect-free (no logging here) -- see `detects_crisis` for the fail-safe
    wrapper callers should actually use."""
    normalized = _normalize(text or "")
    for category, pattern in _CRISIS_PATTERNS:
        if pattern.search(normalized):
            return category
    return None


def detects_crisis(text: str) -> bool:
    """True iff `text` matches one of the curated crisis patterns above. Never raises:
    any internal error is caught, logged at ERROR level (so a broken detector is never
    silently invisible), and treated as "not detected" -- a missed edge case is
    preferable to crashing the chat turn entirely."""
    try:
        return classify_crisis(text) is not None
    except Exception:  # noqa: BLE001 - must never crash a chat turn; see module docstring
        logger.error("crisis_detection internal error while scanning a chat message", exc_info=True)
        return False
