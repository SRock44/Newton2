import { TURNS, attemptLatex, latexPrefixes, typedText, turn } from "./data";

// One continuous take. Every time below is derived from the captured content (lengths of
// what is typed and streamed), so if a capture is replaced the film re-times itself and the
// soundtrack (which is exported from this same object) follows.

export const TYPE_CPS = 100; // a fast, confident typist
export const REVEAL_CPS = 520; // streamed replies, sped up like a promo would
const TOOL_DUR = 0.55;
const TOOL_GAP = 0.12;
export const BUILD_DUR = 4.4; // a ~1-2 minute build, time-lapsed
export const STEP_DELAY = 0.25; // per token typed into the math field

export interface ToolMark {
  tool: string;
  label: string;
  verified: boolean | null;
  start: number;
  done: number;
}
export interface TurnMark {
  k: number;
  kind: "composer" | "stepcheck" | "buildclick";
  clickField?: number;
  typeStart?: number;
  typeEnd?: number;
  typed?: string;
  latexSteps?: string[];
  sendClick: number;
  userAppear: number;
  asstAppear: number;
  tools: ToolMark[];
  /** where the reply text starts/ends streaming (for the build turn: after the block shows) */
  revealStart: number;
  revealEnd: number;
  /** k===3 only: when the finished artifact block appears in the chat */
  blockAt?: number;
  end: number;
}

const marks: TurnMark[] = [];

// ---------------------------------------------------------------- documents page
const docs = {
  windowIn: 2.0,
  cursorIn: 2.7,
  navClick: 3.7,
  uploadClick: 5.6,
  uploadDone: 7.1,
  newChatClick: 10.6,
};
// ---------------------------------------------------------------- attach from Documents
const attach = {
  learnClick: 11.5, // turn Learn Mode on (the real toggle)
  plusClick: 12.8,
  menuExistingClick: 14.0,
  pickerDeckClick: 15.2,
  composerClick: 15.9,
};

let t = attach.composerClick;

for (let k = 0; k < 8; k++) {
  const { user, assistant } = turn(k);
  const latex = attemptLatex(user.content);
  const isBuild = k === 3;
  const kind: TurnMark["kind"] = isBuild ? "buildclick" : latex ? "stepcheck" : "composer";
  const m: Partial<TurnMark> = { k, kind };

  if (kind === "composer") {
    const text = typedText(user.content);
    m.clickField = k === 0 ? t : t + 0.55;
    m.typeStart = m.clickField + 0.3;
    m.typed = text;
    m.typeEnd = m.typeStart + text.length / TYPE_CPS;
    m.sendClick = m.typeEnd + 0.5;
  } else if (kind === "stepcheck") {
    const steps = latexPrefixes(latex!);
    m.clickField = t + 0.6;
    m.typeStart = m.clickField + 0.35;
    m.latexSteps = steps;
    m.typeEnd = m.typeStart + steps.length * STEP_DELAY;
    m.sendClick = m.typeEnd + 0.55;
  } else {
    m.sendClick = t + 1.3; // "Build it" is clicked after the plan card has been read
  }
  m.userAppear = m.sendClick + 0.15;
  m.asstAppear = m.userAppear + 0.5;

  let cursor = m.asstAppear;
  const tools: ToolMark[] = [];
  const captured = assistant.tools ?? [];
  const started = captured.filter((x) => x.type === "tool_start");
  for (const s of started) {
    const end = captured.find((x) => x.type === "tool_end" && x.tool === s.tool && x.label === s.label);
    const isArtifactTool = s.tool === "create_artifact";
    const dur = isArtifactTool ? BUILD_DUR : TOOL_DUR;
    tools.push({
      tool: s.tool,
      // the real UI shows the build's progress label on the chip while it runs
      label: isArtifactTool ? "Building your interactive demo" : s.label,
      verified: end?.verified ?? null,
      start: cursor,
      done: cursor + dur,
    });
    cursor += dur + TOOL_GAP;
  }
  m.tools = tools;

  const contentLen = assistant.content.length;
  if (isBuild) {
    m.blockAt = tools[tools.length - 1].done + 0.1;
    m.revealStart = m.blockAt + 0.1;
    m.revealEnd = m.revealStart + 1.0;
  } else {
    m.revealStart = cursor + 0.1;
    m.revealEnd = m.revealStart + Math.max(1.4, contentLen / REVEAL_CPS);
  }
  m.end = m.revealEnd;
  marks.push(m as TurnMark);

  // hold before the next beat
  const hold = k === 0 ? 1.2 : k === 2 ? 0.2 : k === 3 ? 0 : k === 4 || k === 5 ? 1.2 : k === 7 ? 2.0 : 0.9;
  t = m.end + hold;
}

// ---------------------------------------------------------------- artifact interaction
const build = marks[3];
const artifact = (() => {
  const readyAt = build.blockAt!;
  const expandClick = readyAt + 1.5;
  const start = expandClick + 1.0;
  const end = start + 9.2;
  return { readyAt, expandClick, start, end };
})();

// turns after the artifact wait for the interaction to finish
{
  const shift = artifact.end + 0.9 - marks[4].clickField!;
  // (turn 3's reply streams while the artifact is being explored; turns >=4 start after)
  for (const mk of marks.slice(4)) {
    for (const key of ["clickField", "typeStart", "typeEnd", "sendClick", "userAppear", "asstAppear", "revealStart", "revealEnd", "end"] as const) {
      if (mk[key] !== undefined) (mk[key] as number) += shift;
    }
    for (const tl of mk.tools) {
      tl.start += shift;
      tl.done += shift;
    }
  }
}

export const T = {
  ...docs,
  ...attach,
  marks,
  artifact,
  introEnd: 1.6,
  outroStart: marks[7].end + 3.4,
  total: marks[7].end + 3.4 + 4.6,
};

// ------------------------------------------------------------ artifact control script
/** Values the artifact's controls take over time (mode, L, P) and where the cursor goes. */
export interface ArtifactState {
  mode: "simply" | "cant";
  L: number;
  P: number;
  /** 0..1 — how far down the artifact is brought into view, from its top (the support toggle)
   * to its bottom (the sliders): the chat pane scrolls around it and the artifact scrolls
   * within itself, because the expanded artifact is taller than either */
  scroll: number;
}
const A0 = artifact.start;
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const seg = (t_: number, a: number, b: number) => Math.min(1, Math.max(0, (t_ - a) / (b - a)));

export const artifactTimes = {
  cantClick: A0 + 0.9,
  scrollDownStart: A0 + 1.7,
  scrollDownEnd: A0 + 2.6,
  lDragStart: A0 + 2.9,
  lDragEnd: A0 + 4.2,
  pDragStart: A0 + 4.6,
  pDragEnd: A0 + 6.0,
  scrollUpStart: A0 + 6.3,
  scrollUpEnd: A0 + 7.1,
  simplyClick: A0 + 7.6,
};

export function artifactState(time: number): ArtifactState {
  const a = artifactTimes;
  const mode = time >= a.cantClick + 0.05 && time < a.simplyClick + 0.05 ? "cant" : "simply";
  const L = 2.0 + 1.0 * ease(seg(time, a.lDragStart, a.lDragEnd));
  const P = 10 + 6 * ease(seg(time, a.pDragStart, a.pDragEnd));
  const scroll = ease(seg(time, a.scrollDownStart, a.scrollDownEnd)) * (1 - ease(seg(time, a.scrollUpStart, a.scrollUpEnd)));
  return { mode, L: Math.round(L * 10) / 10, P: Math.round(P * 2) / 2, scroll: Math.round(scroll * 1000) / 1000 };
}

export { TURNS };
