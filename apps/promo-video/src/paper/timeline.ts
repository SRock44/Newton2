import type { CapturedTurn } from "./data";
import { TURNS, turn, typedText } from "./data";

// One continuous take. Every time is derived from the captured content (lengths of what is typed
// and streamed), so a new capture re-times the film and the soundtrack follows.
//
//   1. Documents: upload the scratch lab notes, then the project synopsis (both real files)
//   2. A new chat: attach the synopsis from Documents, ask for an arXiv-style paper plan
//   3. Newton's plan card -> "Request Changes" -> the student's edits -> the revised plan
//   4. "Approve & Write": Newton researches sources and writes the paper (time-lapsed), ending
//      with real "[Attached document: ...]" markers for the PDF and its .tex -- rendered as real,
//      clickable document cards right on that message
//   5. Open the PDF from that card, right there in the chat (DocumentViewerPanel, split with the
//      chat), highlight a real sentence in it, and ask Newton about it -- another real reply

export const TYPE_CPS = 120;
export const REVEAL_CPS = 700; // streamed replies, sped up like a promo would
const TOOL_DUR = 0.55;
const FETCH_DUR = 0.9;
const TOOL_GAP = 0.1;
export const WRITE_DUR = 9.0; // a real run takes minutes; time-lapsed
/** how long the chat pane spends panning across a plan card before its buttons are used */
export const PLAN_PAN = 3.4;

export interface ToolMark {
  tool: string;
  label: string;
  verified: boolean | null;
  start: number;
  done: number;
}
export type TurnKind = "composer" | "approve";
export interface TurnMark {
  k: number;
  kind: TurnKind;
  /** turn 1 begins by clicking the plan's "Request Changes" */
  preClick?: number;
  clickField?: number;
  typeStart?: number;
  typeEnd?: number;
  typed?: string;
  sendClick: number;
  userAppear: number;
  asstAppear: number;
  tools: ToolMark[];
  revealStart: number;
  revealEnd: number;
  /** the window over which the chat pans across a plan card (turns that end in a plan) */
  planPan?: { from: number; to: number };
  end: number;
}

// ---------------------------------------------------------------------- 1. documents
const d0 = 2.9;
export const docs = {
  navClick: d0,
  up1Click: d0 + 1.4,
  up1Done: d0 + 2.7,
  up2Click: d0 + 7.0, // after reading the (messy) notes
  up2Done: d0 + 8.3,
  newChatClick: d0 + 11.4,
};
const attach = {
  plusClick: d0 + 12.4,
  menuExistingClick: d0 + 13.3,
  pickerClick: d0 + 14.2, // the synopsis
  plus2Click: d0 + 15.2, // open "+" again for the second document
  menuExisting2Click: d0 + 16.0,
  picker2Click: d0 + 16.9, // the lab notes
  composerClick: d0 + 17.5,
};

// ------------------------------------------------------------------------ 2-4. the chat
const marks: TurnMark[] = [];
let t = attach.composerClick;

for (let k = 0; k < 3; k++) {
  const { user, assistant } = turn(k);
  const m: Partial<TurnMark> = { k, kind: k === 2 ? "approve" : "composer" };

  if (k === 2) {
    m.sendClick = t + 0.3; // click "Approve & Write"
  } else {
    if (k === 1) {
      m.preClick = t; // "Request Changes" (focuses the composer)
      m.clickField = t + 1.0;
    } else {
      m.clickField = t;
    }
    const text = typedText(user.content);
    m.typeStart = m.clickField + 0.25;
    m.typed = text;
    m.typeEnd = m.typeStart + text.length / TYPE_CPS;
    m.sendClick = m.typeEnd + 0.4;
  }
  m.userAppear = m.sendClick + 0.15;
  m.asstAppear = m.userAppear + 0.45;

  let cursor = m.asstAppear;
  const tools: ToolMark[] = [];
  const captured = assistant.tools ?? [];
  for (const s of captured.filter((x) => x.type === "tool_start")) {
    const dur = s.tool === "write_research_paper" ? WRITE_DUR : s.tool === "research_fetch" || s.tool === "web_search" ? FETCH_DUR : TOOL_DUR;
    const end = captured.find((x) => x.type === "tool_end" && x.tool === s.tool && x.label === s.label);
    tools.push({ tool: s.tool, label: s.label, verified: end?.verified ?? null, start: cursor, done: cursor + dur });
    cursor += dur + TOOL_GAP;
  }
  m.tools = tools;

  m.revealStart = cursor + 0.1;
  m.revealEnd = m.revealStart + Math.max(1.0, assistant.content.length / REVEAL_CPS);
  m.end = m.revealEnd;
  if (k < 2) {
    m.planPan = { from: m.revealEnd + 0.3, to: m.revealEnd + 0.3 + PLAN_PAN };
    m.end = m.planPan.to;
  }
  marks.push(m as TurnMark);
  // after the pan, the student clicks a button on the plan (turn 1's preClick / turn 2's send)
  t = (m.planPan?.to ?? m.end) + 0.6;
}

const writeMark = marks[marks.length - 1];

// ------------------------------------------------------------------------ tool timing, shared
// by the k-loop above and the two hand-built turns below (a real reply's tool chips and its
// streamed reveal, from cursor time `from`).
function assistantTiming(assistant: CapturedTurn, from: number) {
  let cursor = from;
  const tools: ToolMark[] = [];
  const capturedTools = assistant.tools ?? [];
  for (const s of capturedTools.filter((x) => x.type === "tool_start")) {
    const dur = s.tool === "write_research_paper" ? WRITE_DUR : s.tool === "research_fetch" || s.tool === "web_search" ? FETCH_DUR : TOOL_DUR;
    const end = capturedTools.find((x) => x.type === "tool_end" && x.tool === s.tool && x.label === s.label);
    tools.push({ tool: s.tool, label: s.label, verified: end?.verified ?? null, start: cursor, done: cursor + dur });
    cursor += dur + TOOL_GAP;
  }
  const revealStart = cursor + 0.1;
  const revealEnd = revealStart + Math.max(1.0, assistant.content.length / REVEAL_CPS);
  return { tools, revealStart, revealEnd };
}

/** A plain composer turn (no plan card, no preClick) -- turns 3 and 4 below. */
function plainComposerTurn(k: number, clickField: number): TurnMark {
  const { user, assistant } = turn(k);
  const text = typedText(user.content);
  const typeStart = clickField + 0.25;
  const typeEnd = typeStart + text.length / TYPE_CPS;
  const sendClick = typeEnd + 0.4;
  const userAppear = sendClick + 0.15;
  const asstAppear = userAppear + 0.45;
  const { tools, revealStart, revealEnd } = assistantTiming(assistant, asstAppear);
  return { k, kind: "composer", clickField, typeStart, typed: text, typeEnd, sendClick, userAppear, asstAppear, tools, revealStart, revealEnd, end: revealEnd };
}

// ------------------------------------------------------------------------ 5. highlight -> Ask Newton
// Same chat, same session -- no re-attach needed: the write turn's own reply already carries the
// finished PDF as a real, clickable document card (see data.ts's file comment). Pure UI from
// here: open it from that card (DocumentViewerPanel, split with the chat), highlight a real
// sentence in it, and click "Ask Newton". What gets typed and sent next (turn 3) already contains
// that exact quote, because it's exactly what the real capture sent -- see data.ts's REVIEW_QUOTE.
export const reviewPanel = {
  chipClick: writeMark.end + 1.0,
  panelIn: writeMark.end + 1.3,
  panelInDur: 0.6,
  highlightStart: writeMark.end + 2.6,
  highlightDur: 0.7,
  toolbarIn: writeMark.end + 3.5,
  askClick: writeMark.end + 4.4,
};
const followUpMark = plainComposerTurn(3, reviewPanel.askClick + 0.5);
marks.push(followUpMark);

export const viewerOut = followUpMark.end + 1.6; // the panel stays open into the outro, then fades
export const viewerOutDur = 0.7;

export const T = {
  windowIn: 1.6,
  cursorIn: 2.2,
  ...docs,
  ...attach,
  marks,
  reviewPanel,
  viewerOut,
  introEnd: 1.6,
  outroStart: viewerOut + viewerOutDur + 0.6,
  total: viewerOut + viewerOutDur + 0.6 + 3.9,
};

export { TURNS };
export type { CapturedTurn };
