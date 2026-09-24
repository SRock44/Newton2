"""Newton Notepad's highlight-to-act feature (explain / define / summarize a selection
inside a note) -- POST /notes/{id}/annotate, see app/routers/notes.py.

Structurally mirrors app/agents/tutor.py's _plan_narration: one direct, stateless
provider call, no tool-calling loop, no chat history, no persistence of the exchange
itself. Free-tier routed via app.providers.registry.get_provider -- the same
resolution every other non-Pro-gated feature in this codebase uses -- and this module
NEVER imports or calls app.services.billing at all, for the same reason
_plan_narration documents: this is an unbilled operational cost of the product (like
the embedding model itself), not a billed frontier-model routing decision.
"""
import asyncio
import logging
from typing import Literal

from app.providers.base import ChatTurn, TextDelta
from app.providers.registry import get_provider

logger = logging.getLogger(__name__)

AnnotateAction = Literal["explain", "define", "summarize"]

# A generous single paragraph-to-page of surrounding note content -- enough for the
# model to disambiguate the highlighted passage without needing the whole note, and
# small enough to keep this a cheap, fast, single completion regardless of how long the
# note itself has grown. The frontend is expected to send "the surrounding paragraph or
# the whole note" per the feature spec; this cap is the backend's own backstop against
# a pathological request, not the primary truncation point.
MAX_CONTEXT_CHARS = 4000

# Generous but bounded -- these are short completions (a sentence or two to a short
# paragraph, never a full essay, per the prompts below), so a real, healthy response
# should complete well under this; it exists only to keep a slow/broken provider call
# from hanging the request indefinitely.
ANNOTATE_TIMEOUT_SECONDS = 20.0

_SYSTEM_PROMPTS: dict[AnnotateAction, str] = {
    "explain": (
        "You are Newton, an academic tutor. The student highlighted a passage in their "
        "own notes and wants it explained. Using the surrounding context only to "
        "disambiguate what it's referring to, give a clear, concise explanation of the "
        "highlighted passage -- a short paragraph, not a full essay. Do not just repeat "
        "the passage back, and do not explain the surrounding context itself, only the "
        "highlighted passage."
    ),
    "define": (
        "You are Newton, an academic tutor. The student highlighted a term or short "
        "phrase in their own notes and wants a concise definition. Using the "
        "surrounding context to pick the right sense of the term, give a single tight "
        "definition (1-3 sentences) -- not a full explanation, not an example-laden "
        "essay."
    ),
    "summarize": (
        "You are Newton, an academic tutor. The student highlighted a passage in their "
        "own notes and wants it summarized. Using the surrounding context only for "
        "disambiguation, summarize the highlighted passage in your own words, "
        "meaningfully shorter than the original -- a sentence or two for a paragraph, "
        "a short paragraph at most for something longer."
    ),
}


async def annotate_selection(selected_text: str, context: str, action: AnnotateAction) -> str:
    """Runs one direct provider call and returns the generated text for the frontend to
    insert inline into the note (see app/routers/notes.py's POST /notes/{id}/annotate --
    the result is never routed to the main chat window, per the feature's own design).
    Raises on provider failure/timeout -- unlike _plan_narration this is a foreground,
    user-requested action with no "quietly skip" fallback that would make sense."""
    system_prompt = _SYSTEM_PROMPTS[action]
    provider, model = get_provider()
    truncated_context = context[:MAX_CONTEXT_CHARS]
    user_content = (
        f"Surrounding context from the student's note:\n{truncated_context}\n\n"
        f"Highlighted passage to {action}:\n{selected_text}"
    )
    turns = [
        ChatTurn(role="system", content=system_prompt),
        ChatTurn(role="user", content=user_content),
    ]

    async def _call() -> str:
        text = ""
        async for event in provider.stream_chat(turns, model):
            if isinstance(event, TextDelta):
                text += event.text
        return text.strip()

    return await asyncio.wait_for(_call(), timeout=ANNOTATE_TIMEOUT_SECONDS)


# --- Selection topic label -----------------------------------------------------------
# The short "Asking Newton about <x>" / "Defining <x>" label the desktop app shows above
# the chatbox while a highlighted passage is being acted on (see DocumentViewerPanel's
# onSelectionActivity). A label for a UI chip, not an answer, so it is deliberately tiny:
# a few words, one direct provider call, same unbilled free-tier routing as annotate_selection.
TOPIC_TIMEOUT_SECONDS = 10.0
# A highlight can be a whole page; the model only needs the gist to name what it's about.
MAX_TOPIC_INPUT_CHARS = 3000
# Hard ceiling on what reaches a UI chip, whatever the model returns.
MAX_TOPIC_CHARS = 80

_TOPIC_SYSTEM_PROMPT = (
    "You label highlighted passages for a study app. The student highlighted some text and "
    "the app needs a very short label for what it is about, shown as 'Asking Newton about "
    "<label>'. Reply with ONLY that label: a lowercase noun phrase of at most 7 words, no "
    "quotes, no trailing punctuation, no leading verb or 'the passage'. If the highlight "
    "covers several distinct topics, name them together briefly (e.g. 'iteration counts and "
    "convergence rates'). Never answer or explain the passage itself."
)


def _clean_topic(raw: str) -> str:
    """One line, no wrapping quotes/markdown, no trailing punctuation, capped -- whatever
    the model actually returned, this is all that ever reaches a UI chip."""
    lines = [line.strip() for line in raw.strip().splitlines() if line.strip()]
    topic = lines[0] if lines else ""
    # Wrapping quotes/markdown and trailing punctuation can nest ("**label**:"), so peel
    # both until nothing changes rather than in one fixed order.
    while True:
        peeled = topic.strip("\"'`*_ ").rstrip(".:;,!?— -").strip()
        if peeled == topic:
            break
        topic = peeled
    if len(topic) > MAX_TOPIC_CHARS:
        topic = topic[: MAX_TOPIC_CHARS - 1].rstrip() + "…"
    return topic


async def summarize_selection_topic(selected_text: str) -> str:
    """Runs one direct provider call and returns a short topic label for `selected_text`
    ("" if the model gave nothing usable -- the caller falls back to a plain snippet).
    Raises on provider failure/timeout, like annotate_selection; the frontend treats any
    failure as "use the snippet fallback", never as an error worth showing."""
    provider, model = get_provider()
    turns = [
        ChatTurn(role="system", content=_TOPIC_SYSTEM_PROMPT),
        ChatTurn(role="user", content=f"Highlighted text:\n{selected_text[:MAX_TOPIC_INPUT_CHARS]}"),
    ]

    async def _call() -> str:
        text = ""
        async for event in provider.stream_chat(turns, model):
            if isinstance(event, TextDelta):
                text += event.text
        return text

    return _clean_topic(await asyncio.wait_for(_call(), timeout=TOPIC_TIMEOUT_SECONDS))
