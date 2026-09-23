// Every string the promo types or streams is REAL captured Newton output (see
// WEBSITE-ROADMAP.md, Phase 3.11): the study-mode transcript is the real
// "math-catches-mistake" backend capture; the plan-stage reply is Newton's real
// response to the artifact prompt (captured over the real WS chat protocol, never
// approved); the definition is the real `annotate_selection("define")` output for the
// highlighted word. This file only decides WHEN each piece appears.

export const STUDY_PROMPT =
  "Can you check my work? I'm factoring x^2 + 5x + 6 and I got (x + 1)(x + 6). Is that right?";

export const STUDY_REPLY = [
  "I checked your work with real symbolic math, and it's not right yet — let me point to exactly where.",
  "Your answer, **(x + 1)(x + 6), expands to x² + 7x + 6**, not x² + 5x + 6. The problem is the middle term: 1 + 6 = 7, but you need it to sum to 5.",
  "Here's the thinking that's missing: when you factor x² + 5x + 6, you're looking for **two numbers that multiply to 6 AND add to 5**. You found a pair that multiplies to 6 correctly (1 and 6), but the sum gives the wrong middle term.",
  "Try this: can you find a *different* pair of numbers that multiply to 6 but add up to 5 instead of 7? Once you have that pair, plug them in as (x + _)(x + _) and check by expanding — the real computation confirms the correct factorization is (x + 2)(x + 3), but I want to see you get there. What pair do you think works?",
].join("\n\n");

export const STUDY_TOOLS = [
  { tool: "symbolic_math", label: "Solving with symbolic math" },
  { tool: "symbolic_math", label: "Solving with symbolic math" },
  { tool: "check_student_work", label: "Checking your work" },
];

export const NOTE_TITLE = "Bio 101 — Lecture 6";
export const NOTE_INTRO = "Ch. 8 — How plants make food";
export const NOTE_WORD = "Photosynthesis";
export const DEFINE_TEXT =
  "Photosynthesis is the process by which plants, algae, and some bacteria convert light energy into chemical energy, using carbon dioxide and water to produce glucose and release oxygen.";

export const ARTIFACT_PROMPT = "Build me an interactive artifact that teaches the unit circle";

export const PLAN_INTRO =
  "Perfect idea — dragging around the circle is how sine/cosine finally click as coordinates.\n\nHere's what I'll build for you:";

export const PLAN_JSON = JSON.stringify({
  kind: "interactive",
  title: "Draggable Unit Circle Explorer",
  summary:
    "Unit circle with draggable point P, live cos (x) / sin (y) projections and tan segment on x=1, readouts to 3 decimals, quadrant + blow-up notices, and a mirroring angle slider.",
});

export const PLAN_TAIL =
  "It will have:\n" +
  "* Large SVG circle (~280px), radius line to P at angle θ from +x, CCW\n" +
  "* Horizontal projection labeled cos + vertical labeled sin — different dashes + labels, not color alone\n" +
  "* Tangent segment from (1,0) to (1,tanθ), clipped, showing \"undefined\" when |cos|<0.08\n" +
  "* Four readout boxes (θ, cos, sin, tan) + slider 0-360°, step 1°, starting at 30° — drag anywhere or slide, everything redraws continuously\n\n" +
  "Does that plan look good? If you say go ahead, I'll build it.";

export const BUILD_MESSAGE = "Yes — go ahead and build that artifact.";

export const ARTIFACT_DOCUMENT_ID = "c981228f-c878-454a-a4b9-ed5f59092e8a";
export const ARTIFACT_BLOCK = JSON.stringify({
  document_id: ARTIFACT_DOCUMENT_ID,
  title: "Draggable Unit Circle Explorer",
  kind: "interactive",
  attempts: 1,
});
