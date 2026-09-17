"""Artifacts: a real, interactive, self-contained HTML/CSS/JS mini-application, written
by a real coding agent and rendered live in the student's chat.

This is modeled on how Claude.ai actually builds Artifacts -- the conversational model
doesn't write the file itself, it hands a brief to a separate coding agent that does the
real file-writing. Here the coding agent is `opencode` (github.com/sst/opencode), run
headless in services/artifact-runner against OpenRouter, using the exact same model
identifier and the exact same API key every other model call in this app already uses
(Settings.openrouter_model / OPENROUTER_API_KEY -- see app/providers/registry.py and
app/services/billing.py's PRO_MODELS entry for that same string).

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
specific kind, which is what the four personas below encode.

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
from typing import Any, Literal

from app.db.base import SessionLocal
from app.db.models import User
from app.core.config import get_settings
from app.providers.base import ChatTurn, TextDelta
from app.providers.registry import get_provider
from app.services import billing as billing_service
from app.services.artifact_build import ArtifactBuildResult, build_artifact
from app.services.documents import store_artifact_html
from app.tools.base import Tool

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

ARTIFACT_KINDS = ("diagram", "chart", "slideshow", "interactive")

# Bounded like every other "put user text into a prompt" call site in this codebase
# (write_research_paper.MAX_DOCUMENT_EXCERPT_CHARS, flashcards.MAX_MATERIAL_CHARS).
MAX_PROMPT_CHARS = 4000
# The brief is what gets handed to opencode as its task. Long is good here -- detail is
# the entire value the persona adds -- but not unbounded, since it's also real input
# tokens on every one of opencode's own steps.
MAX_BRIEF_CHARS = 6000
MAX_TITLE_CHARS = 80


# ---------------------------------------------------------------------------
# The artifact-agent personas.
#
# Each is a real system prompt for one kind of artifact, written around what actually
# makes THAT kind good and what makes it bad. They share a common instruction block
# (_BRIEF_CONTRACT) about the output format and the hard constraints of the medium, and
# differ completely in their expertise. All four are deliberately opinionated: a brief
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

The brief must be concrete and decided. Never write "include appropriate labels" or
"choose suitable colors" — say which labels and which colors. The coding agent has no
knowledge of the student's course, cannot ask questions, and will implement literally
whatever you specify and nothing you leave out. Anything you don't decide, it will
decide badly.

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
        "relating them — give the coding agent the real math, it must not guess. "
        "Everything is plain inline JS with requestAnimationFrame/SVG/canvas; no physics "
        "or plotting library is available.\n"
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


async def _write_brief(kind: str, prompt: str) -> tuple[str, str, int, int]:
    """Stage 1: one direct provider call (never through run_tutor's tool loop -- the same
    "call a provider directly" pattern app/tools/write_research_paper.py's _draft_section
    and app/services/flashcards use) turning the student's request into a real coding
    brief. Returns (title, brief, prompt_tokens, completion_tokens); the token counts are
    real usage read off the provider, for the metering in _charge_usage below."""
    provider, model = get_provider()
    raw = ""
    async for event in provider.stream_chat(
        [
            ChatTurn(role="system", content=_PERSONA_PROMPTS[kind]),
            ChatTurn(role="user", content=prompt[:MAX_PROMPT_CHARS]),
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
            user_id, get_settings().openrouter_model, prompt_tokens, completion_tokens
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
        "chart, slideshow, or interactive demo) — that renders live in the chat. A real "
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
                    "what teaches the idea."
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
        },
        "required": ["kind", "prompt"],
    }

    async def run(
        self,
        kind: Literal["diagram", "chart", "slideshow", "interactive"],
        prompt: str,
        user_id: str | None = None,
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

        title, brief, brief_prompt_tokens, brief_completion_tokens = await _write_brief(kind, prompt)

        result = await build_artifact(brief, get_settings().openrouter_model)

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
