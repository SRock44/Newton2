import { NOTE, NOTE_TYPED_FULL, TURNS, attemptLatex, latexPrefixes, typedText, turn } from "./data";

// One continuous take. Every time below is derived from the captured content (lengths of
// what is typed and streamed), so if a capture is replaced the film re-times itself and the
// soundtrack (which is exported from this same object) follows.
//
//   1. Notepad (one live WYSIWYG editor): type notes (formatted as they are written), highlight +
//      Define, highlight + Explain — the answers land as cards right in the note
//   2. Documents: upload the lecture handout, open a new chat, Learn Mode on, attach it from
//      Documents via "+"
//   3. Conversation (Learn Mode): Step Checks that derive the rule from the product rule, a
//      sign error Newton pushes back on, a Checkpoint about where the minus comes from, then
//      Newton Research with real sources.

export const TYPE_CPS = 78; // a fast, confident typist
export const NOTE_CPS = 40;
export const REVEAL_CPS = 330; // streamed replies, sped up like a promo would
export const RESEARCH_REVEAL_CPS = 300;
const TOOL_DUR = 0.5;
const TOOL_GAP = 0.1;
export const RESEARCH_DUR = 3.0; // a real research run takes ~a minute; time-lapsed
const FETCH_DUR = 0.85; // each source read while the run is on
export const STEP_DELAY = 0.24; // per token typed into the math field

export interface ToolMark {
  tool: string;
  label: string;
  verified: boolean | null;
  start: number;
  done: number;
}
export type TurnKind = "composer" | "stepcheck" | "checkpoint";
export interface TurnMark {
  k: number;
  kind: TurnKind;
  clickField?: number;
  typeStart?: number;
  typeEnd?: number;
  typed?: string;
  latexSteps?: string[];
  sendClick: number;
  userAppear: number;
  asstAppear: number;
  tools: ToolMark[];
  revealStart: number;
  revealEnd: number;
  end: number;
}

// ------------------------------------------------------------------------ 1. the Notepad
const nb: Record<string, number> = {};
nb.windowIn = 1.5;
nb.cursorIn = 2.0;
nb.nbIn = 2.8;
nb.nbInDur = 0.9;
nb.bodyClick = 4.0;
nb.typeStart = 4.3;
nb.typeEnd = nb.typeStart + NOTE_TYPED_FULL.length / NOTE_CPS;
// highlight "LIATE" -> Define
// no mode switch: the note already looks the way it will, so he just moves on to highlighting
nb.selTermStart = nb.typeEnd + 1.2;
nb.selDur = 0.6;
nb.toolbarTerm = nb.selTermStart + nb.selDur + 0.1;
nb.defineClick = nb.toolbarTerm + 0.9;
nb.defineShown = nb.defineClick + 0.15;
// highlight the formula -> Explain
nb.selFormulaStart = nb.defineShown + 1.0;
nb.toolbarFormula = nb.selFormulaStart + nb.selDur + 0.1;
nb.explainClick = nb.toolbarFormula + 0.9;
nb.explainShown = nb.explainClick + 0.15;
// the finished note, in place: Newton's answers are cards right in the text; scroll through it
nb.scrollStart = nb.explainShown + 1.0;
nb.scrollEnd = nb.scrollStart + 5.4;
nb.nbOut = nb.scrollEnd + 0.6;
nb.nbOutDur = 0.7;

// -------------------------------------------------------------------- 2. documents + attach
const d0 = nb.nbOut + 0.9;
const docs = {
  navClick: d0,
  uploadClick: d0 + 1.5,
  uploadDone: d0 + 2.9,
  newChatClick: d0 + 5.7,
};
const attach = {
  learnClick: d0 + 6.8,
  plusClick: d0 + 7.9,
  menuExistingClick: d0 + 8.9,
  pickerDeckClick: d0 + 9.9,
  composerClick: d0 + 10.6,
};

// ------------------------------------------------------------------------ 3. the chat
const marks: TurnMark[] = [];
let t = attach.composerClick;

for (let k = 0; k < 6; k++) {
  const { user, assistant } = turn(k);
  const latex = attemptLatex(user.content);
  const kind: TurnKind = k === 4 ? "checkpoint" : latex ? "stepcheck" : "composer";
  const m: Partial<TurnMark> = { k, kind };

  if (kind === "composer" || kind === "checkpoint") {
    const text = typedText(user.content);
    m.clickField = k === 0 ? t : t + 0.45;
    m.typeStart = m.clickField + 0.25;
    m.typed = text;
    m.typeEnd = m.typeStart + text.length / TYPE_CPS;
    m.sendClick = m.typeEnd + 0.4;
  } else {
    const steps = latexPrefixes(latex!);
    m.clickField = t + 0.45;
    m.typeStart = m.clickField + 0.3;
    m.latexSteps = steps;
    m.typeEnd = m.typeStart + steps.length * STEP_DELAY;
    m.sendClick = m.typeEnd + 0.45;
  }
  m.userAppear = m.sendClick + 0.15;
  m.asstAppear = m.userAppear + 0.45;

  let cursor = m.asstAppear;
  const tools: ToolMark[] = [];
  const captured = assistant.tools ?? [];
  for (const s of captured.filter((x) => x.type === "tool_start")) {
    const end = captured.find((x) => x.type === "tool_end" && x.tool === s.tool && x.label === s.label);
    const research = s.tool === "deep_research";
    const dur = research ? RESEARCH_DUR : s.tool === "research_fetch" || s.tool === "web_search" ? FETCH_DUR : TOOL_DUR;
    tools.push({ tool: s.tool, label: s.label, verified: end?.verified ?? null, start: cursor, done: cursor + dur });
    cursor += dur + TOOL_GAP;
  }
  m.tools = tools;

  const cps = k === 5 ? RESEARCH_REVEAL_CPS : REVEAL_CPS;
  m.revealStart = cursor + 0.1;
  m.revealEnd = m.revealStart + Math.max(1.0, assistant.content.length / cps);
  m.end = m.revealEnd;
  marks.push(m as TurnMark);

  // hold before the next beat (long enough to read a pushback / the aha)
  t = m.end + (k === 0 ? 1.6 : k === 2 ? 2.0 : k === 3 ? 1.8 : 1.4);
}

const last = marks[marks.length - 1];
export const T = {
  nb,
  ...docs,
  ...attach,
  marks,
  introEnd: 1.6,
  outroStart: last.end + 2.4,
  total: last.end + 2.4 + 3.9,
};

export { TURNS, NOTE };
