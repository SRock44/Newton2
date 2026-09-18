"""Artifacts: a real, interactive, self-contained HTML/CSS/JS mini-application, written
by a real coding agent and rendered live in the student's chat.

This is modeled on how Claude.ai actually builds Artifacts -- the conversational model
doesn't write the file itself, it hands a brief to a separate coding agent that does the
real file-writing. Here the coding agent is `opencode` (github.com/sst/opencode), run
headless in services/artifact-runner against OpenRouter, using the same OPENROUTER_API_KEY
every other model call in this app uses but its own dedicated model choice
(Settings.artifact_generation_model -- see that setting's own comment in
app/core/config.py for why this diverges from Settings.openrouter_model, and for the
training-data-consent tradeoff it carries).

THE TWO-STAGE SHAPE, and why the persona stage is not decoration
-----------------------------------------------------------------
    student's request
      -> [stage 1] an ARTIFACT-AGENT PERSONA (one direct provider call, this module)
         turns it into a detailed, concrete coding brief
      -> [stage 2] opencode (services/artifact-runner) iteratively writes artifact.html
         against that brief, with validator-driven self-correction
      -> stored as a real Document (kind="artifact") and rendered in chat in a
         sandboxed iframe

A coding agent is very good at writing code and has no opinion about pedagogy. Handed
"make me a diagram of the nitrogen cycle" it will produce four labelled boxes and some
arrows. The persona layer is what turns that same request into "an 800x500 cycle diagram
with the four transformation stages arranged clockwise, each arrow labelled with the
organism responsible, the two human-input arrows visually distinguished from the natural
ones, because the thing students actually get wrong here is which step fixes and which
step releases" -- real subject expertise about what makes a *good* artifact of that
specific kind, which is what the five personas below encode.

Structurally this tool is the sibling of app/tools/write_research_paper.py: a Pro-gated,
genuinely multi-stage generation tool that makes its own direct provider calls (never
through run_tutor's tool loop), does real work in a runner service, stores real Document
rows, and returns an honest summary -- never a false success.

COST
----
This is the most expensive single action in the app, by some distance, and that is
stated honestly to the student rather than hidden (see the frontend's ArtifactPlanCard).
It is gated the same way the other two expensive tools are (Pro-only, exactly like
start_study_session and write_research_paper) AND -- unlike those -- its real,
measured token spend is charged to the student's credit ledger through
billing.record_frontier_usage, the same mechanism the frontier-model chat path uses.
See _charge_usage below for why an artifact meters when a research paper doesn't.
"""

import json
import re
import uuid
from typing import Any, Awaitable, Callable, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import SessionLocal
from app.db.models import Document, Flashcard, User
from app.core.config import get_settings
from app.providers.base import ChatProvider, ChatTurn, TextDelta
from app.providers.openai_compatible import OpenAICompatibleProvider
from app.providers.registry import get_provider
from app.services import billing as billing_service
from app.services.anki import build_flashcard_decks
from app.services.artifact_build import ArtifactBuildResult, build_artifact
from app.services.documents import get_document_text, store_artifact_html
from app.tools.base import Tool
from app.tools.document_resolution import resolve_document

# Gated exactly like start_study_session (app/tools/study_session.py) and
# write_research_paper (app/tools/write_research_paper.py), whose wording this follows:
# name what is Pro, then name the real, unrestricted alternative the student still has.
# Artifacts are a stronger case for this gate than either of those -- a build is a
# persona call plus a multi-step agentic coding run, several model round trips for one
# request -- but the gate is deliberately the SAME mechanism, not a new one.
PRO_ONLY_MESSAGE = (
    "Building an interactive artifact is a Pro feature — it runs a real coding agent, "
    "which costs a lot more than a normal reply. I can still explain this in chat, "
    "draw it out step by step, or graph it with plot_function."
)

# The credit half of the gate. Unlike the Pro checks above, this can be true for a Pro
# user who has genuinely spent their allowance -- so the message says what actually
# happened and what fixes it, in the same non-punitive register as the DocumentsPanel's
# free-plan generation note, rather than reading as a punishment.
NO_CREDIT_MESSAGE = (
    "You've used up this period's credit, and an artifact build is expensive enough "
    "that I'd rather not start one you can't pay for partway through. Your allowance "
    "resets at the start of your next billing period, or you can top up in Settings. "
    "I can still explain or sketch this out in chat in the meantime."
)

# Focus Mode blocks this the same way it blocks write_research_paper, and for a narrower
# version of the same reason. Focus Mode is a student holding THEMSELVES to doing the
# work; an artifact is a thing Newton makes for them. See write_research_paper's
# FOCUS_MODE_MESSAGE for the full framing of why a Pro plan doesn't override a student's
# own stricter self-imposed setting.
FOCUS_MODE_MESSAGE = (
    "Focus Mode is on, so I won't build this for you — it's meant to keep you doing "
    "the work yourself. I can still talk you through how you'd build it, or explain "
    "the concept behind it. Turn Focus Mode off in Settings if you'd like the artifact."
)

ARTIFACT_KINDS = ("diagram", "chart", "slideshow", "interactive", "quiz")

# The second of two real, honest progress labels a build reports live via on_progress
# (the first -- "Planning your X" -- is app/agents/tutor.py's _ARTIFACT_PLANNING_LABELS,
# shown from the moment the tool is called; this one replaces it once the brief is
# actually written and the real opencode build is starting). Kept here rather than in
# tutor.py since it's this module's own domain knowledge of what each kind is called,
# not the agent layer's.
_ARTIFACT_BUILDING_LABELS: dict[str, str] = {
    "diagram": "Drawing your diagram",
    "chart": "Building your chart",
    "slideshow": "Building your slideshow",
    "interactive": "Building your interactive demo",
    "quiz": "Building your quiz game",
}

# Bounded like every other "put user text into a prompt" call site in this codebase
# (write_research_paper.MAX_DOCUMENT_EXCERPT_CHARS, flashcards.MAX_MATERIAL_CHARS).
MAX_PROMPT_CHARS = 4000
# The brief is what gets handed to opencode as its task -- real input tokens on every one
# of opencode's own steps, and (per _BRIEF_CONTRACT's own LENGTH guidance, ~400 words)
# the persona is now asked to stay well under this anyway. This is a hard backstop for
# when it doesn't listen, not the primary control -- lowered from 6000 alongside that
# prompt change (2026-09-17, real observed multi-minute builds/timeouts against the live
# deployed dev box on briefs that were exhaustively over-specified at the old length).
MAX_BRIEF_CHARS = 4000
MAX_TITLE_CHARS = 80

# ---------------------------------------------------------------------------
# GROUNDED SOURCE MATERIAL -- the one thing "quiz" needs that no other kind does.
#
# The other four kinds invent all of their content from the student's free-text
# description: a diagram "about the nitrogen cycle" is a diagram the persona and the
# coding agent make up between them, and that's correct -- the request IS the spec.
#
# A quiz over "my Bio 101 deck" is not. If the coding agent writes plausible-looking
# Bio 101 questions instead of the student's OWN cards, the artifact is a convincing
# fake: the student reviews material they never wrote, believing it's their deck. So
# when a document is named, the REAL rows are read out of the database and carried
# verbatim into the brief, with an explicit instruction not to invent anything. See
# _quiz_source_block below for the fetch and _ground_brief for why the block is
# appended by CODE after the persona has spoken, rather than trusted to the persona's
# own copying.
# ---------------------------------------------------------------------------
MAX_QUIZ_CARDS = 30
MAX_QUIZ_SOURCE_CHARS = 3000


# ---------------------------------------------------------------------------
# The artifact-agent personas.
#
# Each is a real system prompt for one kind of artifact, written around what actually
# makes THAT kind good and what makes it bad. They share a common instruction block
# (_BRIEF_CONTRACT) about the output format and the hard constraints of the medium, and
# differ completely in their expertise. All five are deliberately opinionated: a brief
# that says "include relevant elements" is worthless to a coding agent, so each persona
# is told, explicitly, to make concrete decisions rather than hedge.
# ---------------------------------------------------------------------------

_BRIEF_CONTRACT = """
YOUR OUTPUT
You are not writing the artifact. You are writing the BRIEF for a coding agent that
will write it. Reply with the brief itself and nothing else — no preamble, no "here is
the brief", no markdown fences around the whole thing.

Start with exactly one line in this form, then a blank line, then the brief:

TITLE: <a short, specific title for this artifact, max 8 words>

LENGTH: aim for well under 250 words. A longer brief is not a more careful one — past
this length you are usually specifying things the coding agent can be trusted with on
its own, and every extra word here is a word it has to read before it writes a single
line of code, and a real cost in how long the student waits. Be decisive, not exhaustive.

SCOPE: this matters as much as length, and is a separate thing — a short brief can still
describe an elaborate build. Every element you ask for (another decorative shape, another
animated flourish, another visual state) is code the coding agent has to actually write,
and writing it is the real cost in how long the student waits, not just reading your
brief. Design the SMALLEST thing that genuinely teaches the point — one clear scene or
mechanism, not an illustrated environment around it. A student learns the physics of a
falling object from a dot and an arrow as reliably as from a rendered bucket, a building,
a sky, and clouds; the extra scenery is where builds get slow without getting more
correct. Default to the plainer version and only add a visual element when its absence
would genuinely make the artifact fail at its one job — never for realism or polish on
its own.

The brief must be concrete and decided about the things that would be WRONG if left to
chance: the actual content (the real labels, values, steps, formulas — never "include
appropriate labels" or "choose suitable colors" when you can just say which), the
structural/pedagogical choices that determine whether it teaches the right thing, and
the couple of details a working demo can't function without. It must NOT be concrete
about everything else — exact pixel coordinates for every element, an exact hex shade
for each minor part, a fully-worked closed-form formula when "update the value each
frame using the real physics relationship" already pins down the one thing that matters
(that it be physically correct, not that it match your derivation to three decimals).
Trust the coding agent's own ordinary judgment for layout and visual polish; spend your
words on the few decisions that would actually be bad if left unmade. The coding agent
has no knowledge of the student's course and cannot ask questions, so the content and
the teaching point still need to be fully decided — it is precision about VISUAL/
IMPLEMENTATION MINUTIAE specifically that this brief should stop supplying.

Cover, in prose or short sections (not a rigid template):
- WHO it's for: the student's apparent level, and what they're likely to already know
  vs. what this has to teach them.
- WHAT IT MUST SHOW: the specific content — the actual labels, the actual values, the
  actual steps, named. If the request implies real subject knowledge, supply it; the
  coding agent will not know it.
- LAYOUT: how it is arranged on screen, in real terms (what's where, roughly what size,
  what order the eye should travel in).
- INTERACTION: exactly what the student can do with it, and what happens when they do.
  If the honest answer is "nothing, it's a static picture", say that — a fake
  interaction is worse than none.
- WHAT WOULD MAKE THIS BAD: two or three specific failure modes to avoid, in this
  particular artifact.

HARD CONSTRAINTS OF THE MEDIUM (the coding agent is told these too; write a brief that
respects them):
- One single self-contained HTML file. All CSS in a <style> tag, all JS in a <script>
  tag. No CDN libraries, no web fonts, no external images — graphics must be inline SVG,
  canvas, or CSS. So: never specify D3, Chart.js, Three.js, Tailwind, Google Fonts, or
  a stock photo.
- It renders in a sandboxed iframe with no storage access and no network. No
  localStorage, no fetch, no saving. All data must be written into the file.
- It must be legible at 360px wide as well as full width.
- It should look at home in a calm, modern study app: generous whitespace, a restrained
  palette, system font stack, no clip art, no gradients-for-the-sake-of-gradients.
  Never rely on color alone to carry meaning — pair it with a label, a shape, or a
  pattern, so it still reads for a colorblind student.
"""

_PERSONA_PROMPTS: dict[str, str] = {
    "diagram": (
        "You are an expert at explanatory diagrams for teaching — the kind of figure a "
        "great textbook or a great lecturer draws, not the kind a slide-deck template "
        "generates.\n\n"
        "What you know that a coding agent doesn't:\n"
        "- A diagram's job is to make ONE relationship visible. A diagram trying to show "
        "everything about a topic shows nothing. Pick the relationship that the student's "
        "request is really about, and cut everything that doesn't serve it.\n"
        "- Structure carries the meaning before any label does. A cycle must be drawn as "
        "a closed loop; a hierarchy as real containment or real levels; a process as a "
        "single unambiguous direction of flow; a comparison as genuine side-by-side "
        "alignment where corresponding parts line up. Choosing the wrong topology is the "
        "single most common way a diagram lies.\n"
        "- Arrows are claims. Every arrow means something specific — 'becomes', 'causes', "
        "'flows into', 'inhibits' — and an unlabelled arrow makes the student guess. Say "
        "in the brief what each arrow asserts, and specify when two arrow types must look "
        "different (e.g. solid for the main pathway, dashed for a feedback or inhibitory "
        "one) with a legend explaining the difference.\n"
        "- Labels belong ON the thing, not in a numbered key the eye has to shuttle to. "
        "Specify direct labelling wherever it fits.\n"
        "- Spatial position should mean something — left-to-right as time, top-to-bottom "
        "as scale or hierarchy, inside/outside as membership. Incidental placement is a "
        "wasted channel.\n"
        "- The best teaching diagrams mark where students go wrong: the step that's "
        "commonly reversed, the two parts that get confused. Call for that emphasis "
        "explicitly when the topic has such a place.\n\n"
        "Specify the diagram as inline SVG with real coordinates and a real viewBox, in "
        "enough detail that the coding agent is placing YOUR diagram, not improvising "
        "one. Give it the actual node labels and the actual arrow labels.\n"
        + _BRIEF_CONTRACT
    ),
    "chart": (
        "You are an expert at data visualization — rigorous about encoding, and hostile "
        "to chartjunk.\n\n"
        "What you know that a coding agent doesn't:\n"
        "- The chart type follows from the question, not from taste. Comparing values "
        "across categories → bars (horizontal when labels are long). Change over time → "
        "a line. Relationship between two quantities → a scatter. Part-to-whole with few "
        "parts → a stacked bar, and only reach for a pie with 2-3 slices at most. A "
        "distribution → a histogram. Say which one and say why in one line, so the coding "
        "agent doesn't substitute something flashier.\n"
        "- Bar charts start at zero. Always. Line charts may use a non-zero baseline, but "
        "only if the brief says so deliberately and the axis is labelled to make it "
        "obvious. Truncating a bar axis is a misrepresentation, not a style choice.\n"
        "- The data has to be real and it has to be stated. Give actual numbers with "
        "actual units in the brief, and name where they come from (a textbook value, the "
        "student's own figures, a clearly-flagged illustrative example). If the numbers "
        "are illustrative rather than measured, require the chart to say so on its face. "
        "Never let the coding agent invent plausible-looking data.\n"
        "- The title should state the finding, not the variables: 'Reaction rate doubles "
        "every 10°C', not 'Rate vs. Temperature'. Axes need units. Gridlines should be "
        "faint or absent. No 3D, no drop shadows, no decorative gradients.\n"
        "- Direct-label the series where possible instead of forcing a legend lookup, and "
        "annotate the specific point the student is supposed to notice.\n"
        "- One or two well-chosen accent colors against neutral gray carry more meaning "
        "than a full categorical palette. Reserve color for the thing that matters.\n\n"
        "Specify the chart as hand-written inline SVG (no charting library is available), "
        "including the axis ranges, tick values, and the exact data points. Tooltips on "
        "hover are welcome if they add real precision; a tooltip that just repeats the "
        "visible label is noise.\n"
        + _BRIEF_CONTRACT
    ),
    "slideshow": (
        "You are an expert at visual explanation in sequence — the progressive, "
        "one-idea-at-a-time build that a good teacher uses at a whiteboard, not a "
        "corporate deck.\n\n"
        "What you know that a coding agent doesn't:\n"
        "- A slide is not a paragraph with a border. Each slide carries exactly one idea, "
        "expressed mostly visually, with text as caption rather than as content. If a "
        "slide needs three sentences to make its point, it is really two or three slides.\n"
        "- Sequence is the whole pedagogy. Order the slides so each one is answerable "
        "with only what the previous slides established — build up, never forward-"
        "reference. Six to ten slides is the right length for one concept; twenty is a "
        "sign the topic wasn't narrowed.\n"
        "- The strongest structure for teaching is: the concrete situation → the question "
        "it raises → the idea that answers it → the idea applied again somewhere new → "
        "what to remember. Name the role each slide plays in the brief.\n"
        "- Visual continuity is what makes a sequence feel like one explanation: keep the "
        "same object on screen across slides and change one thing about it, rather than "
        "cutting to an unrelated picture each time. Say explicitly what persists between "
        "slides and what changes.\n"
        "- The last slide should be the one worth screenshotting — the summary the "
        "student would want in front of them during an exam.\n\n"
        "Specify: the exact slide count, and for EACH slide its role, its headline text "
        "(write the actual words), and what is drawn on it. Also specify the navigation: "
        "Previous/Next buttons, arrow-key support, a visible position indicator "
        "(e.g. '3 / 8'), and that it must not wrap past the last slide silently. Slides "
        "are divs shown and hidden by inline JS — there is no slide library available.\n"
        + _BRIEF_CONTRACT
    ),
    "interactive": (
        "You are an expert at interactive explanations and explorable explanations — "
        "small demos where manipulating something is what teaches the idea.\n\n"
        "What you know that a coding agent doesn't:\n"
        "- The interaction must BE the lesson. The test: if the student can't learn the "
        "concept without touching the controls, it's a real interactive; if the controls "
        "just animate a fact they could have read, it's decoration. Say in the brief what "
        "the student is supposed to discover by manipulating it.\n"
        "- Choose the parameter that changes the student's mind. Usually that's the one "
        "with a surprising, non-linear, or counterintuitive effect — the point where "
        "behavior qualitatively flips, the value where the obvious guess is wrong. "
        "Exposing three boring sliders is worse than exposing one that matters.\n"
        "- Feedback must be immediate and continuous: the visualization updates as a "
        "slider drags, not on a 'Run' click. A delay between action and effect breaks "
        "the causal link the whole thing exists to build.\n"
        "- Show the numbers alongside the picture. A slider with no readout, or a "
        "visualization with no values, leaves the student unable to connect what they see "
        "to what they'd write on a test.\n"
        "- Constrain the controls to a range where the thing stays meaningful, give them "
        "a sensible starting value that already shows something interesting (never a "
        "blank or degenerate state), and label each control with its real quantity and "
        "unit.\n"
        "- Say what the student should notice. A short line of text near the "
        "visualization that changes with the state ('past this angle, the projectile's "
        "range starts falling again') is often the highest-value element on the page.\n"
        "- If the concept has a right answer, let them be wrong and show them why, rather "
        "than preventing the wrong input.\n\n"
        "Specify: each control (type, real range, step, starting value, label with "
        "units), exactly what recomputes and redraws on change, and the formula or rule "
        "relating them — give the coding agent the real math, it must not guess, because "
        "getting the relationship wrong is the one failure that would actually teach the "
        "student something false. That correctness requirement is about the RELATIONSHIP "
        "(what really depends on what, and how), not about the scene it's drawn in —  a "
        "believable bucket, building, or spring doesn't need its every pixel and color "
        "dictated any more than the diagram/chart kinds' coordinate precision applies "
        "here; describe the scene in a sentence or two and let the coding agent draw it. "
        "Everything is plain inline JS with requestAnimationFrame/SVG/canvas; no physics "
        "or plotting library is available.\n"
        + _BRIEF_CONTRACT
    ),
    "quiz": (
        "You are an expert at retrieval-practice games — the small, fast, replayable "
        "review loop that actually moves a student's recall, not a worksheet with a "
        "Submit button at the bottom.\n\n"
        "What you know that a coding agent doesn't:\n"
        "- Retrieval is the whole mechanism. The student must commit to an answer BEFORE "
        "seeing it — type it, pick it, or say 'I know this' and then self-grade. A page "
        "that shows the question and the answer together teaches nothing; it is a list "
        "with extra steps. Specify the commit step explicitly.\n"
        "- Feedback is immediate and specific, never deferred to the end. The instant an "
        "answer is committed: say right or wrong, show the correct answer in full, and "
        "when it was wrong show it NEXT TO what they said so the difference is visible. "
        "A score revealed only on the last screen is a test, not practice.\n"
        "- A visible running state is what makes it a game rather than a form. Commit to "
        "one in the brief: a streak plus a position ('4 of 12') is the strongest pair — "
        "the streak gives the student something to protect, the position tells them how "
        "much is left.\n"
        "- Replayability is a design requirement, not a nice-to-have. Shuffle the order "
        "every run (Fisher-Yates at start, never a fixed sequence), and offer 'Retry the N "
        "you missed' on the end screen alongside 'Play again' — the missed ones are "
        "exactly the ones worth another pass, and making a student replay all twelve to "
        "redrill three is how they stop using it.\n"
        "- Multiple choice needs real distractors: other plausible answers from the SAME "
        "material — the neighbouring term, the commonly confused pair, another card's "
        "answer — never obviously-wrong filler, and never options whose length or grammar "
        "gives it away. A question that can't be given three honest distractors should be "
        "a type-in or a self-graded reveal instead; say which.\n"
        "- Check typed answers forgivingly (trim, case-fold, ignore punctuation and a "
        "leading 'the'/'a'). A student marked wrong over a capital letter closes the tab "
        "and doesn't come back, so when a strict compare would be unreliable, prefer "
        "reveal-then-self-grade ('I got it' / 'I missed it').\n"
        "- There must be an unmistakable done state: final score, the list of what they "
        "missed with the right answers, and the two buttons above. Ending by silently "
        "disabling Next is a broken game.\n\n"
        "Specify: the exact question format(s), the exact interaction on submit, the "
        "scoring/streak rule, the shuffle, the end screen's contents and buttons, and "
        "keyboard support (one question on screen at a time, Enter to submit and to "
        "advance). Everything is plain inline JS with the questions written into the file "
        "as a JS array — there is no storage, so a high score cannot persist between "
        "reloads; do not specify one.\n\n"
        "ABOUT THE QUESTIONS THEMSELVES: if the request comes with the student's own "
        "material — real flashcards or a real document excerpt, marked as such below the "
        "request — those questions and answers are the content, exactly as given. Design "
        "the game around them; do not rewrite them, do not add topics they don't cover, "
        "and do not pad the set to a rounder number. (You do not need to re-list the "
        "cards in your brief — the verbatim list is attached to it automatically. Refer "
        "to them by number.) With no material attached, you may write questions from "
        "general knowledge of the topic, but only claims you'd stand behind: no invented "
        "dates, figures, or definitions presented as fact.\n"
        + _BRIEF_CONTRACT
    ),
}

_TITLE_LINE_RE = re.compile(r"^\s*TITLE:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
# Same sanitization shape write_research_paper._sanitize_filename uses -- a filename
# derived from model-produced text must never contain a path separator.
_UNSAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9 _.-]+")


def _parse_brief(raw: str, kind: str, fallback_title: str) -> tuple[str, str]:
    """Splits the persona's reply into (title, brief). A missing/blank TITLE line is not
    an error worth failing a build over -- fall back to a title derived from the
    student's own request and use the whole reply as the brief, which is exactly what it
    is."""
    match = _TITLE_LINE_RE.search(raw)
    if not match:
        return fallback_title, raw.strip()[:MAX_BRIEF_CHARS]
    title = match.group(1).strip()[:MAX_TITLE_CHARS] or fallback_title
    brief = (raw[: match.start()] + raw[match.end() :]).strip()
    return title, (brief or raw.strip())[:MAX_BRIEF_CHARS]


def _sanitize_filename(title: str) -> str:
    cleaned = _UNSAFE_FILENAME_RE.sub("", title).strip() or "artifact"
    return cleaned[:MAX_TITLE_CHARS]


def _fallback_title(prompt: str) -> str:
    """A title from the student's own words, for when the persona didn't give one."""
    words = prompt.strip().split()
    return " ".join(words[:8])[:MAX_TITLE_CHARS] or "Artifact"


# The exact instruction that travels with real student material. Deliberately blunt and
# repeated at both ends of the block: this is the one place in the Artifacts pipeline
# where an invented answer is not a quality problem but a correctness one -- a student
# reviewing fabricated "their own" cards is worse off than if the build had failed. The
# register matches tutor.py's SYSTEM_PROMPT rule about research papers ("Never fabricate
# data, statistics, experimental results, or quotations that don't trace back to the
# student's own material... say so rather than inventing support").
_CARDS_PREAMBLE = (
    "THE STUDENT'S OWN FLASHCARDS — THIS IS THE CONTENT OF THE QUIZ.\n"
    "Use ONLY these exact questions and answers. Do not invent, add, remove, reword, "
    "translate, or 'improve' any of them, and do not pad the set with extra questions of "
    "your own. Every question in the finished artifact must be one of the cards below, "
    "with its front as the question and its back as the correct answer, character for "
    "character. Distractors for a multiple-choice question must be drawn from the OTHER "
    "cards' backs below, never made up. If you think a card is wrong or badly worded, "
    "use it anyway — it is the student's own material, not yours to edit."
)

_TEXT_PREAMBLE = (
    "THE STUDENT'S OWN DOCUMENT — THIS IS THE SOURCE MATERIAL FOR THE QUIZ.\n"
    "This document has no flashcards, so write the questions yourself — but every "
    "question and every correct answer must be grounded in the text below and traceable "
    "to a specific line of it. Never fabricate a fact, figure, date, definition, or "
    "quotation that isn't in this text, and don't reach for outside knowledge of the "
    "topic to fill gaps: if the text doesn't support enough questions, write fewer. "
    "Prefer answers that are a word or phrase appearing in the text itself."
)

_CARDS_CLOSER = (
    "END OF THE STUDENT'S CARDS. Those are all of them and they are the only questions "
    "this artifact may contain."
)

_TEXT_CLOSER = "END OF THE STUDENT'S DOCUMENT. Every question must come from the text above."

# Honest refusals, in the same register as the rest of this module's messages: say what
# actually happened and what the student can do instead, rather than silently building
# something adjacent to what was asked for.
NO_SUCH_DOCUMENT_MESSAGE = (
    "I couldn't find that document in your library, and I'd rather not build a quiz out "
    "of made-up questions and call it yours. Tell me the file or note name as it appears "
    "in your Documents panel and I'll build it from the real thing."
)

EMPTY_DOCUMENT_MESSAGE = (
    "That document has no flashcards and no readable text in it, so there's nothing real "
    "to quiz you on — and a quiz I invented wouldn't be your material. Generate "
    "flashcards from it first (or tell me a topic to quiz you on instead) and I'll build "
    "the game from those."
)


async def _quiz_source_block(
    db: AsyncSession, user_id: uuid.UUID, document_id: str
) -> tuple[str | None, str | None]:
    """The student's REAL material for a grounded quiz, as a block of text destined for
    the coding brief verbatim. Returns (block, error_message) -- exactly one is non-None.

    `document_id` is a document id when the caller has one, and otherwise a filename hint,
    resolved through app/tools/document_resolution.resolve_document -- the same single
    place generate_flashcards, generate_practice_exam and start_study_session already use
    to answer "which of this student's documents did they mean". Both forms are accepted
    because the tutor model genuinely only ever sees filenames (retrieved RAG chunks carry
    no ids), so a strictly-uuid parameter would be a parameter it could never fill.

    Card fetching is app/services/anki.py's build_flashcard_decks, unchanged and not
    reimplemented: it is already the codebase's one answer to "this user's flashcards for
    this document, grouped by source document, with a `general` bucket for cards with no
    source", it is already user-scoped at the query level, and reusing it means a quiz and
    an Anki export can never disagree about what is in a deck.
    """
    document: Document | None = None
    try:
        document = await db.get(Document, uuid.UUID(document_id))
    except ValueError:
        # Not a uuid -- treat it as the filename hint every other generation tool takes.
        document = await resolve_document(db, user_id, document_id)
    # The ownership check is explicit rather than implied: db.get() by primary key is not
    # user-scoped, and a quiz must never be built from another student's document.
    if document is None or document.user_id != user_id:
        return None, NO_SUCH_DOCUMENT_MESSAGE

    decks = await build_flashcard_decks(db, user_id, document_id=document.id)
    cards: list[Flashcard] = [card for _label, group in decks for card in group]
    if cards:
        lines = [_CARDS_PREAMBLE, "", f"Deck: {document.filename}", ""]
        used = 0
        budget = MAX_QUIZ_SOURCE_CHARS
        for card in cards[:MAX_QUIZ_CARDS]:
            entry = f"{used + 1}. FRONT: {card.front}\n   BACK: {card.back}"
            # Bounded by whole cards, never by a character count. Slicing the joined block
            # at MAX_QUIZ_SOURCE_CHARS would be the obvious thing and would be a real bug:
            # it can cut a card mid-answer, and a truncated answer handed to the coding
            # agent under "use these exact answers" is a WRONG answer presented as the
            # student's own -- worse than dropping the card outright.
            if used and len(entry) + 1 > budget:
                break
            lines.append(entry)
            budget -= len(entry) + 1
            used += 1
        if used < len(cards):
            lines.append("")
            lines.append(
                f"(This deck has {len(cards)} cards. The {used} above are the ones to use; "
                "they are the complete set for this artifact.)"
            )
        lines.extend(["", _CARDS_CLOSER])
        return "\n".join(lines), None

    # No cards: a plain note or an uploaded file the student never generated a deck from.
    # Its real text is the grounding instead -- fetched through the same
    # documents.get_document_text every other tool that needs a document's content uses.
    try:
        text = (await get_document_text(document)).strip()
    except Exception:  # noqa: BLE001 - an unreadable object is "no material", not a 500
        text = ""
    if not text:
        return None, EMPTY_DOCUMENT_MESSAGE
    block = "\n".join(
        [_TEXT_PREAMBLE, "", f"Document: {document.filename}", "", text[:MAX_QUIZ_SOURCE_CHARS], "", _TEXT_CLOSER]
    )
    return block, None


def _ground_brief(brief: str, source_block: str | None) -> str:
    """Appends the student's real material to the persona's brief, so the exact strings
    reach the coding agent.

    Why this is done in code and not left to the persona: the persona is a language model
    being asked to copy 30 question/answer pairs through a generation step that is also
    summarizing and restructuring, and _parse_brief truncates its reply at
    MAX_BRIEF_CHARS. Both of those are places a card can quietly change a word or fall off
    the end, and the failure is invisible -- the artifact still looks like a working quiz.
    The persona is shown the cards (it needs them to make real design decisions about
    distractors and question format) and told not to re-list them; this function is what
    actually guarantees the verbatim text is in what opencode reads. The block gets its
    budget FIRST and the persona's prose is trimmed around it, for the same reason.
    """
    if not source_block:
        return brief[:MAX_BRIEF_CHARS]
    room = MAX_BRIEF_CHARS - len(source_block) - 2
    if room <= 0:
        return source_block
    return f"{brief[:room].rstrip()}\n\n{source_block}"


def _artifact_provider() -> tuple[ChatProvider, str]:
    """Provider+model for BOTH create_artifact stages -- deliberately bypasses
    get_provider()'s normal BYOK/Groq/OpenRouter priority order (the same reason
    app/agents/tutor.py's _select_provider does for Pro frontier routing): this tool is
    already Pro-gated by the time either stage runs, and the whole point is a specific,
    deliberately-chosen model (settings.artifact_generation_model -- see its own comment
    in app/core/config.py), not whichever provider a BYOK key or Groq happen to imply.
    Falls back to the normal get_provider() behavior (including the keyless EchoProvider)
    when OpenRouter itself isn't configured at all, matching every other call site's
    graceful dev-mode handling rather than raising."""
    settings = get_settings()
    if settings.openrouter_api_key:
        return (
            OpenAICompatibleProvider(
                base_url="https://openrouter.ai/api/v1",
                api_key=settings.openrouter_api_key.get_secret_value(),
            ),
            settings.artifact_generation_model,
        )
    return get_provider()


async def _write_brief(
    kind: str, prompt: str, source_block: str | None = None
) -> tuple[str, str, int, int]:
    """Stage 1: one direct provider call (never through run_tutor's tool loop -- the same
    "call a provider directly" pattern app/tools/write_research_paper.py's _draft_section
    and app/services/flashcards use) turning the student's request into a real coding
    brief. Returns (title, brief, prompt_tokens, completion_tokens); the token counts are
    real usage read off the provider, for the metering in _charge_usage below.

    `source_block` is the student's own material for a grounded quiz (see
    _quiz_source_block). It is appended AFTER the MAX_PROMPT_CHARS truncation rather than
    concatenated before it, so a long chat-derived prompt can never push the real cards
    out of the persona's view; it has its own bound already."""
    provider, model = _artifact_provider()
    user_content = prompt[:MAX_PROMPT_CHARS]
    if source_block:
        user_content = f"{user_content}\n\n{source_block}"
    raw = ""
    async for event in provider.stream_chat(
        [
            ChatTurn(role="system", content=_PERSONA_PROMPTS[kind]),
            ChatTurn(role="user", content=user_content),
        ],
        model,
    ):
        if isinstance(event, TextDelta):
            raw += event.text

    usage = getattr(provider, "last_usage", None) or {}
    title, brief = _parse_brief(raw, kind, _fallback_title(prompt))
    return title, brief, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)


async def _charge_usage(
    user_id: uuid.UUID, prompt_tokens: int, completion_tokens: int
) -> int:
    """Charges an artifact build's REAL measured token spend to the student's credit
    ledger, via exactly the same billing.record_frontier_usage every metered call in this
    app goes through (Pro monthly allowance first, spilling onto a purchased top-up
    balance -- see that function's docstring for the ordering and why).

    Why an artifact meters when a research paper doesn't: the existing tools all make
    calls whose cost is bounded and roughly known per call, and they run on the free-tier
    default model, so the Pro gate alone is a fair proxy for their cost. An artifact's
    cost is genuinely open-ended -- a multi-step agentic coding run whose token count
    depends on how many turns the agent takes and how big the file gets, measured here at
    5-15x a normal reply and varying by more than that between requests. Charging it the
    same flat "you're Pro, go ahead" as everything else would be the exact thing this
    ledger exists to avoid. This app's billing model already supports real differentiated
    per-action cost; this uses it rather than inventing a second mechanism.

    Never raises: a metering failure must not destroy an artifact the student already
    paid the real OpenRouter cost for. Returns cents charged (0 if nothing was)."""
    if prompt_tokens <= 0 and completion_tokens <= 0:
        return 0
    try:
        return await billing_service.record_frontier_usage(
            user_id, get_settings().artifact_generation_model, prompt_tokens, completion_tokens
        )
    except Exception:  # noqa: BLE001 - see docstring
        return 0


def _failure_summary(result: ArtifactBuildResult) -> str:
    """An honest failure message -- never a false success, the same rule
    write_research_paper follows when a LaTeX compile never produced a PDF. Surfaces the
    validator's real complaints, since those are specific and actionable, rather than the
    raw agent log, which is long and mostly noise."""
    if result.timed_out:
        return (
            "The artifact build ran out of time before it finished. That usually means "
            "the request was too big for one artifact — try asking for a narrower piece "
            "of it and we can build that."
        )
    if result.problems:
        problems = "; ".join(result.problems[:3])
        return (
            "The coding agent's artifact didn't pass validation, even after a correction "
            f"pass. What was actually wrong: {problems}"
        )
    return f"The artifact build failed before producing anything. Real error: {result.log[-500:]}"


class CreateArtifactTool(Tool):
    """Builds a real, interactive, self-contained HTML/CSS/JS artifact by handing an
    artifact-agent persona's coding brief to the `opencode` coding agent running in
    services/artifact-runner. See this module's docstring for the two-stage shape and
    why the persona stage does real work."""

    name = "create_artifact"
    description = (
        "Builds a real interactive artifact — a self-contained mini web page (diagram, "
        "chart, slideshow, interactive demo, or quiz game) — that renders live in the chat. A real "
        "coding agent writes it, so it takes 1-3 minutes and costs meaningfully more "
        "than a normal reply: only call it after the student has confirmed they want "
        "it (offer an ```artifact-plan block first). Prefer plot_function for a plain "
        "graph of an equation, and prefer explaining in chat for anything a picture "
        "wouldn't genuinely help with."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": list(ARTIFACT_KINDS),
                "description": (
                    "diagram = an explanatory figure showing how parts relate; chart = a "
                    "data visualization of real values; slideshow = a stepped visual "
                    "explanation; interactive = a demo where manipulating a control is "
                    "what teaches the idea; quiz = a playable review game with scoring "
                    "and immediate feedback, built from a deck or note when one is named."
                ),
            },
            "prompt": {
                "type": "string",
                "description": (
                    "What the student wants, in full, including any subject/course "
                    "context and level from the conversation. More detail here means a "
                    "better artifact — this is the only thing the artifact agent sees."
                ),
            },
            "document_id": {
                "type": "string",
                "description": (
                    "For kind='quiz' only: the deck or note to build the game from, as "
                    "its filename or a substring of it (e.g. 'bio 101'), exactly like "
                    "generate_flashcards' document_filename. Pass this whenever the "
                    "student points at specific material ('quiz me on my Bio 101 deck', "
                    "'turn this note into a game') — the real cards or the real text get "
                    "used, instead of questions being invented. Omit it when they name "
                    "only a topic."
                ),
            },
        },
        "required": ["kind", "prompt"],
    }

    async def run(
        self,
        kind: Literal["diagram", "chart", "slideshow", "interactive", "quiz"],
        prompt: str,
        document_id: str | None = None,
        user_id: str | None = None,
        on_progress: Callable[[str], Awaitable[None]] | None = None,
    ) -> str:
        if not user_id:
            return "Error: no signed-in user to build an artifact for."
        try:
            uid = uuid.UUID(user_id)
        except ValueError:
            return "Error: invalid user id."

        if kind not in _PERSONA_PROMPTS:
            return f"Error: unsupported artifact kind '{kind}' -- expected one of {sorted(ARTIFACT_KINDS)}."
        if not prompt or not prompt.strip():
            return "Error: prompt must not be empty."

        source_block: str | None = None
        async with SessionLocal() as db:
            user = await db.get(User, uid)
            if user is None or not billing_service.is_pro(user):
                return PRO_ONLY_MESSAGE
            if user.focus_mode_enabled:
                return FOCUS_MODE_MESSAGE
            # The credit half of the gate, checked BEFORE any spend rather than after --
            # reusing frontier_access_available, the single place this app decides
            # "does this user have funded model budget right now", so the artifact path
            # can't drift from the chat path's answer to the same question.
            if not billing_service.frontier_access_available(
                user, bool(get_settings().openrouter_api_key)
            ):
                return NO_CREDIT_MESSAGE

            # A quiz over named material reads that material here, inside the same
            # pre-spend session as the gate, so a document that doesn't exist or has
            # nothing in it costs the student nothing and -- much more importantly --
            # never silently becomes a quiz of invented questions with their deck's name
            # on it. Other kinds ignore document_id: they are specified entirely by the
            # request, which is the real difference between them and this one.
            # str() because tool arguments are model-authored JSON: a filename that looks
            # numeric ("101") can arrive as a number, and .strip() on an int is a crash.
            named = str(document_id).strip() if document_id is not None else ""
            if kind == "quiz" and named:
                source_block, error = await _quiz_source_block(db, uid, named)
                if error:
                    return error

        title, brief, brief_prompt_tokens, brief_completion_tokens = await _write_brief(
            kind, prompt, source_block
        )
        # The student's real cards/text are re-attached to the brief by code, never left
        # to the persona to have copied faithfully. See _ground_brief.
        brief = _ground_brief(brief, source_block)

        # Real, honest progress: the brief is genuinely done and the real (usually the
        # slower) opencode build is genuinely about to start -- never a fake/heuristic
        # "still working..." on a timer. See _ARTIFACT_BUILDING_LABELS' own comment for
        # why this label lives here rather than in tutor.py.
        if on_progress is not None:
            await on_progress(_ARTIFACT_BUILDING_LABELS.get(kind, "Building your artifact"))

        result = await build_artifact(brief, get_settings().artifact_generation_model)

        # Charge whatever really got spent, including on a failed build: those tokens
        # were genuinely billed to this app by OpenRouter whether or not an artifact came
        # out, and quietly eating the cost of a failure would make the ledger a fiction.
        await _charge_usage(
            uid,
            brief_prompt_tokens + result.input_tokens,
            brief_completion_tokens + result.output_tokens,
        )

        if not result.success or not result.html:
            return _failure_summary(result)

        # The artifact's RAG text is a description, not its markup -- see
        # store_artifact_html's own docstring for why.
        rag_text = f"Interactive {kind} artifact: {title}\n\n{brief}"
        async with SessionLocal() as db:
            document = await store_artifact_html(
                db, uid, f"{_sanitize_filename(title)}.html", result.html, rag_text
            )
            document_id = str(document.id)

        # Same convention as app/tools/visualizer.py's ```plotly-figure: the tool result
        # IS the fenced block, and the Tutor relays it verbatim (see tutor.py's
        # SYSTEM_PROMPT). Deliberately carries only the document id, not the HTML -- the
        # markup would otherwise be pasted into the model's own context on this and every
        # following turn of the conversation, for no benefit; the frontend fetches the
        # real bytes from GET /documents/{id}/raw instead.
        return (
            "```newton-artifact\n"
            f'{{"document_id": "{document_id}", "title": {_json_string(title)}, '
            f'"kind": "{kind}", "attempts": {result.attempts}}}'
            "\n```"
        )


def _json_string(value: str) -> str:
    """JSON string escaping for the fenced block above -- a title comes from the model,
    so it can contain quotes, backslashes, or newlines that would otherwise make the
    block unparseable in the frontend."""
    return json.dumps(value)
