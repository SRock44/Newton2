import captured from "../../showcase/captured.json";

// Everything Newton says in the showcase film is REAL backend output recorded in
// showcase/captured.json (see showcase/capture.py): a real .docx uploaded to Documents, the
// real Notepad highlight-to-act responses (POST /notes/{id}/annotate), the real Learn Mode
// chat over the WS protocol (Checkpoint pushback, Step Checks), and a real deep_research run
// with real fetched sources. The student's messages are the scripted half. This module only
// exposes them and decides how replies are split for progressive reveal.

export interface CapturedTool {
  type: string;
  tool: string;
  label: string;
  verified: boolean | null;
}
export interface CapturedTurn {
  role: "user" | "assistant";
  content: string;
  tools?: CapturedTool[];
}

export const DOC = captured.doc as { id: string; filename: string; mime_type: string; created_at: string };
export const DOC_CONTENT = (captured.doc_content as { content: string }).content;
export const TURNS = captured.turns as CapturedTurn[];
const ANN = captured.annotations as { action: "define" | "explain"; selected: string; text: string }[];
export const DEFINE = ANN.find((a) => a.action === "define")!;
export const EXPLAIN = ANN.find((a) => a.action === "explain")!;

/** The student's earlier documents (their own files, not Newton output). */
export const OLD_DOCS = [
  {
    id: "d-old-1",
    filename: "MATH1220_Syllabus.pdf",
    mime_type: "application/pdf",
    created_at: "2026-01-12T09:10:00Z",
    text: "MATH 1220 Calculus II — Syllabus\n\nWeek 11: Techniques of integration\nWeek 12: Integration by parts\nWeek 13: Partial fractions · Midterm 3 (Thursday)",
  },
  {
    id: "d-old-2",
    filename: "Physics_Formula_Sheet.md",
    mime_type: "text/markdown",
    created_at: "2026-01-20T14:30:00Z",
    text: "# Mechanics formula sheet\n\nNewton's second law: F = m a\nWork: W = ∫ F · dx\nMomentum: p = m v",
  },
];

export const STUDENT = "Priya";
export const NOTE_TITLE = "Calc II — Lecture 12";
/** What a brand-new note is called until the student names it (the app defaults to the date). */
export const DEFAULT_NOTE_TITLE = "2026-02-03";
/** Topic tags the student gives the new note (the Notepad's tags feature). */
export const NOTE_TAGS = ["Calc II", "Integration"];
/** The student's notes from other classes, each tagged with its class and topic. */
export const NOTE_LIST = [
  { title: "Bio 101 — Lecture 6", tags: ["Bio 101", "Photosynthesis"], updated: "2026-02-02T15:20:00Z" },
  { title: "Physics 201 — Lecture 14", tags: ["Physics 201", "Momentum"], updated: "2026-02-02T11:05:00Z" },
  { title: "Organic Chem — Reaction mechanisms", tags: ["Chem 210", "SN1 / SN2"], updated: "2026-01-30T09:40:00Z" },
  { title: "Stats — Confidence intervals", tags: ["Stats 130", "Inference"], updated: "2026-01-28T19:15:00Z" },
];

/** The turn pairs, by role. Turn k = (user, assistant). */
export const turn = (k: number) => ({ user: TURNS[2 * k], assistant: TURNS[2 * k + 1] });

/** Text of a user message with the attach marker stripped (what the student typed). */
export const typedText = (content: string) => content.replace(/\n\n\[Attached document: [^\]]+\]/, "");

const ATTEMPT_RE = /^My attempt: \$([\s\S]*)\$$/;
/** The LaTeX a student types into a Step Check card, or null for an ordinary message. */
export function attemptLatex(content: string): string | null {
  const m = content.match(ATTEMPT_RE);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------- the Notepad note
// Raw markdown, exactly what the Notepad's Write mode holds. Highlight-to-act inserts the
// response right after the highlighted text as a ```newton-note fenced block (see
// desktop NotepadWindow.insertAnnotation) — the same string building is used here.
export const NOTE = {
  title: "# Integration by parts",
  formula: "∫ u dv = uv − ∫ v du",
  pre: "\n\nUse it when the integrand is a product. Pick u by ",
  term: "LIATE",
  post: "\n\nExample: ∫ x eˣ dx → u = x, dv = eˣ dx",
};
export const noteBlock = (action: "define" | "explain", text: string) =>
  "\n\n```newton-note\n" + JSON.stringify({ action, text }) + "\n```\n";

export interface NoteState {
  /** full raw markdown after the (optional) insertions */
  content: string;
  /** index ranges of the pieces, for measuring/highlighting in the rendered text */
  formulaAt: number;
  termAt: number;
  defineAt: number;
  explainAt: number;
}
export function noteState(defined: boolean, explained: boolean): NoteState {
  const head = NOTE.title + "\n\n";
  const formulaAt = head.length;
  const explainBlock = explained ? noteBlock("explain", EXPLAIN.text) : "";
  const defineBlock = defined ? noteBlock("define", DEFINE.text) : "";
  const afterFormula = formulaAt + NOTE.formula.length;
  const termAt = afterFormula + explainBlock.length + NOTE.pre.length;
  const content = head + NOTE.formula + explainBlock + NOTE.pre + NOTE.term + defineBlock + NOTE.post;
  return { content, formulaAt, termAt, explainAt: afterFormula, defineAt: termAt + NOTE.term.length };
}
/** The note the student has typed so far (before any insertion). */
export const NOTE_TYPED_FULL = noteState(false, false).content;

// ---------------------------------------------------------------------------------------
// Progressive reveal that never shows half-open math, bold, code or a half-open fenced block.
export function safePrefix(text: string, n: number): string {
  if (n >= text.length) return text;
  if (n <= 0) return "";
  let cut = n;
  for (let guard = 0; guard < 8; guard++) {
    const head = text.slice(0, cut);
    const fences = (head.match(/```/g) ?? []).length;
    if (fences % 2 === 1) {
      const close = text.indexOf("```", cut);
      if (close === -1) return text;
      cut = close + 3;
      continue;
    }
    const dd = (head.match(/\$\$/g) ?? []).length;
    if (dd % 2 === 1) {
      const close = text.indexOf("$$", cut);
      if (close === -1) return text;
      cut = close + 2;
      continue;
    }
    const bold = (head.match(/\*\*/g) ?? []).length;
    if (bold % 2 === 1) {
      const close = text.indexOf("**", cut);
      if (close === -1) return text;
      cut = close + 2;
      continue;
    }
    const ticks = (head.replace(/```/g, "").match(/`/g) ?? []).length;
    if (ticks % 2 === 1) {
      const close = text.indexOf("`", cut);
      if (close === -1) return text;
      cut = close + 1;
      continue;
    }
    const singles = (head.replace(/\$\$/g, "").match(/\$/g) ?? []).length;
    if (singles % 2 === 1) {
      const close = text.indexOf("$", cut);
      if (close === -1) return text;
      cut = close + 1;
      continue;
    }
    // never cut inside a markdown link/url token or a half-typed word
    const tail = text.slice(cut, cut + 1);
    if (tail && !/\s/.test(tail) && /\S$/.test(head)) {
      const sp = text.slice(cut).search(/\s/);
      if (sp === -1) return text;
      cut += sp;
      continue;
    }
    break;
  }
  return text.slice(0, cut);
}

/** Balanced LaTeX prefixes for typing into the math field (cut only at top-level tokens). */
export function latexPrefixes(latex: string): string[] {
  const cuts: number[] = [];
  let i = 0;
  const readGroup = (j: number): number => {
    if (latex[j] !== "{") return j;
    let depth = 0;
    let k = j;
    for (; k < latex.length; k++) {
      if (latex[k] === "{") depth++;
      else if (latex[k] === "}" && --depth === 0) return k + 1;
    }
    return k;
  };
  while (i < latex.length) {
    if (latex[i] === "\\") {
      let j = i + 1;
      while (j < latex.length && /[a-zA-Z]/.test(latex[j])) j++;
      if (j === i + 1) j++;
      const cmd = latex.slice(i + 1, j);
      const groups = cmd === "dfrac" || cmd === "frac" ? 2 : cmd === "text" || cmd === "sqrt" ? 1 : 0;
      for (let g = 0; g < groups; g++) j = readGroup(j);
      i = j;
    } else if (latex[i] === "_" || latex[i] === "^") {
      let j = i + 1;
      j = latex[j] === "{" ? readGroup(j) : j + 1;
      i = j;
    } else {
      i++;
    }
    cuts.push(i);
  }
  return cuts.map((c) => latex.slice(0, c));
}
