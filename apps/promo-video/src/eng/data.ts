import captured from "../../engineer/captured.json";

// Everything Newton says in the engineer film is the REAL backend output recorded in
// engineer/captured.json (see engineer/capture.py): a real .pptx uploaded to Documents, the
// real chat that followed over the real WS protocol, the real artifact Newton built. The
// student's messages are the scripted half of the conversation. This module only exposes
// them and splits assistant replies into the pieces the film reveals.

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
export const ARTIFACT_HTML = captured.artifact_html as string;
export const ARTIFACT_META = captured.artifact_meta as { document_id: string; title: string; kind: string };
export const ARTIFACT_DOCUMENT_ID = ARTIFACT_META.document_id;

/** The student's earlier documents (their own files, not Newton output). */
export const OLD_DOCS = [
  {
    id: "d-old-1",
    filename: "ME3310_Syllabus.pdf",
    mime_type: "application/pdf",
    created_at: "2026-01-12T09:10:00Z",
    text: "ME 3310 Mechanics of Materials — Syllabus\n\nWeek 9: Beam bending and deflection\nWeek 10: Combined loading\nMidterm 2: Thursday, week 11",
  },
  {
    id: "d-old-2",
    filename: "Thermo_Formula_Sheet.md",
    mime_type: "text/markdown",
    created_at: "2026-01-20T14:30:00Z",
    text: "# Thermodynamics formula sheet\n\nFirst law: dU = δQ − δW\nCarnot efficiency: η = 1 − T_c / T_h\nIdeal gas: PV = nRT",
  },
];

export const STUDENT = "Marcus";

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

// ---------------------------------------------------------------------------------------
// Progressive reveal that never shows half-open math or a half-open fenced block.

/**
 * The first `n` characters of `text`, extended forward when the cut lands inside a fenced
 * block, a $$ block, or an inline $...$ span, so KaTeX and real fenced components
 * (math-steps, step-check, artifact-plan) appear whole instead of flickering as raw source.
 */
export function safePrefix(text: string, n: number): string {
  if (n >= text.length) return text;
  if (n <= 0) return "";
  let cut = n;
  for (let guard = 0; guard < 6; guard++) {
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
      if (j === i + 1) j++; // \, \; etc.
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
