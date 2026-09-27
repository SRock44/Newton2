import type { CapturedTurn } from "./data";
import { CARDS, EXAM_GRADED, REVIEWS, TURNS, turn, typedText } from "./data";

// One continuous take. Every time is derived from the captured content (lengths of what is typed
// and streamed), so a new capture re-times the film and the soundtrack follows.
//
//   1. Documents: upload the student's Midterm 2 packet (a dated schedule + the five techniques)
//   2. A new chat: attach it, ask Newton to set them up to study -- Newton builds a study session
//      (dated study plan + flashcards + a practice exam) in one go and says what it made
//   3. Study plan: the seven real deadlines, extracted with their dates
//   4. Calendar: those deadlines sit on the calendar; the student adds their own study block
//   5. Flashcards: review a few (FSRS-scheduled), then the whole deck with Anki / PowerPoint export
//   6. Practice exam: take it, submit, get graded (73%) with an explanation for every miss
//   7. Home: "What to study next" -- the weak areas the review and the exam really produced --
//      and the button that reviews exactly those cards
//   8. Back in chat: "where should I focus?" -- Newton answers from that real performance data

export const TYPE_CPS = 120;
export const REVEAL_CPS = 700; // streamed replies, sped up like a promo would
const TOOL_DUR = 0.55;
const TOOL_GAP = 0.1;
/** a real study session (three generations at once) takes about a minute; time-lapsed */
export const SESSION_DUR = 5.0;

export interface ToolMark {
  tool: string;
  label: string;
  verified: boolean | null;
  start: number;
  done: number;
}
export interface TurnMark {
  k: number;
  clickField: number;
  typeStart: number;
  typeEnd: number;
  typed: string;
  sendClick: number;
  userAppear: number;
  asstAppear: number;
  tools: ToolMark[];
  revealStart: number;
  revealEnd: number;
  end: number;
}

function assistantTiming(assistant: CapturedTurn, from: number) {
  let cursor = from;
  const tools: ToolMark[] = [];
  const captured = assistant.tools ?? [];
  for (const s of captured.filter((x) => x.type === "tool_start")) {
    const dur = s.tool === "start_study_session" ? SESSION_DUR : TOOL_DUR;
    const end = captured.find((x) => x.type === "tool_end" && x.tool === s.tool && x.label === s.label);
    tools.push({ tool: s.tool, label: s.label, verified: end?.verified ?? null, start: cursor, done: cursor + dur });
    cursor += dur + TOOL_GAP;
  }
  const revealStart = cursor + 0.1;
  const revealEnd = revealStart + Math.max(1.0, assistant.content.length / REVEAL_CPS);
  return { tools, revealStart, revealEnd };
}

function composerTurn(k: number, clickField: number): TurnMark {
  const { user, assistant } = turn(k);
  const typed = typedText(user.content);
  const typeStart = clickField + 0.25;
  const typeEnd = typeStart + typed.length / TYPE_CPS;
  const sendClick = typeEnd + 0.4;
  const userAppear = sendClick + 0.15;
  const asstAppear = userAppear + 0.45;
  const { tools, revealStart, revealEnd } = assistantTiming(assistant, asstAppear);
  return { k, clickField, typeStart, typeEnd, typed, sendClick, userAppear, asstAppear, tools, revealStart, revealEnd, end: revealEnd };
}

// ---------------------------------------------------------------------- 1. documents
const d0 = 2.9;
export const docs = {
  navClick: d0,
  uploadClick: d0 + 1.4,
  uploadDone: d0 + 2.9,
  docHover: d0 + 3.9, // the packet's card in the list
  detailLook: d0 + 5.4, // reading its extracted content
  newChatClick: d0 + 8.4,
};
export const attach = {
  plusClick: d0 + 9.4,
  menuExistingClick: d0 + 10.2,
  pickerClick: d0 + 11.1, // the packet
  composerClick: d0 + 11.9,
};

// -------------------------------------------------------------------------- 2. the study session
export const first = composerTurn(0, attach.composerClick);

// ------------------------------------------------------------------------ 3. study plan panel
const p0 = first.end + 1.5;
export const plan = {
  navClick: p0,
  open: p0 + 0.18,
  hoverFirst: p0 + 1.6,
  hoverMidterm: p0 + 4.6,
  closeClick: p0 + 7.4,
  close: p0 + 7.58,
};

// --------------------------------------------------------------------------- 4. calendar panel
const c0 = plan.close + 0.9;
export const EVENT_TITLE = "Trig substitution drill";
export const EVENT_NOTES = "Right-triangle method: sin, tan and sec cases";
export const EVENT_START_LOCAL = "2026-02-04T18:00";
export const cal = {
  navClick: c0,
  open: c0 + 0.18,
  hoverDeadline: c0 + 1.5,
  newEventClick: c0 + 3.4,
  formOpen: c0 + 3.58,
  titleTypeStart: c0 + 4.2,
  titleTypeEnd: c0 + 4.2 + EVENT_TITLE.length / 18,
  startSet: c0 + 4.2 + EVENT_TITLE.length / 18 + 0.35,
  addClick: c0 + 4.2 + EVENT_TITLE.length / 18 + 1.35,
  added: c0 + 4.2 + EVENT_TITLE.length / 18 + 1.55,
  // held ~5.5 s after the event lands: the new block on screen, then the agenda scrolls down to the
  // Midterm 2 entry
  closeClick: c0 + 4.2 + EVENT_TITLE.length / 18 + 7.1,
  close: c0 + 4.2 + EVENT_TITLE.length / 18 + 7.28,
};

// ------------------------------------------------------------------------ 5. flashcards panel
const f0 = cal.close + 0.9;
/** the cards the film reviews on screen -- the first ones, exactly as they were really rated */
export const CARD_COUNT = 4;
export const CARD_CYCLE = 2.7;
export const cards = {
  navClick: f0,
  open: f0 + 0.18,
  /** card i: shown at start(i); revealed by a click at reveal(i); rated at rate(i) */
  start: (i: number) => f0 + 0.6 + i * CARD_CYCLE,
  reveal: (i: number) => f0 + 0.6 + i * CARD_CYCLE + 0.9,
  rate: (i: number) => f0 + 0.6 + i * CARD_CYCLE + 2.05,
  ratings: REVIEWS.slice(0, CARD_COUNT).map((r) => r.rating),
  browseClick: f0 + 0.6 + CARD_COUNT * CARD_CYCLE + 0.4,
  browse: f0 + 0.6 + CARD_COUNT * CARD_CYCLE + 0.58,
  closeClick: f0 + 0.6 + CARD_COUNT * CARD_CYCLE + 4.2,
  close: f0 + 0.6 + CARD_COUNT * CARD_CYCLE + 4.38,
};

// ------------------------------------------------------------------------ 6. practice exam panel
const e0 = cards.close + 0.9;
export const ANSWER_SHOWN = 5; // questions answered one by one on screen; the rest fill in fast
export const exam = {
  navClick: e0,
  open: e0 + 0.18,
  examClick: e0 + 1.6,
  opened: e0 + 1.78,
  answer: (i: number) => e0 + 2.6 + i * 0.6,
  fillRest: e0 + 2.6 + ANSWER_SHOWN * 0.6 + 0.3,
  scrollStart: e0 + 2.6 + ANSWER_SHOWN * 0.6 + 1.0,
  scrollEnd: e0 + 2.6 + ANSWER_SHOWN * 0.6 + 3.0,
  submitClick: e0 + 2.6 + ANSWER_SHOWN * 0.6 + 3.6,
  graded: e0 + 2.6 + ANSWER_SHOWN * 0.6 + 3.85,
  // the score banner is held on screen for ~2 s before the view scrolls to the first miss
  explainStart: e0 + 2.6 + ANSWER_SHOWN * 0.6 + 6.2,
  explainEnd: e0 + 2.6 + ANSWER_SHOWN * 0.6 + 8.4,
  closeClick: e0 + 2.6 + ANSWER_SHOWN * 0.6 + 11.6,
  close: e0 + 2.6 + ANSWER_SHOWN * 0.6 + 11.78,
};

// -------------------------------------------------------------------------------- 7. home
const h0 = exam.close + 0.9;
export const home = {
  navClick: h0,
  viewIn: h0 + 0.2,
  hoverDue: h0 + 1.4,
  scrollStart: h0 + 2.4,
  scrollEnd: h0 + 4.2, // scrolled down to "What to study next"
  hoverWeak: h0 + 4.9,
  reviewClick: h0 + 7.2, // "Review flashcards" on the weak area
  scopedOpen: h0 + 7.38,
  closeClick: h0 + 11.6,
  scopedClose: h0 + 11.78,
};

// ---------------------------------------------------------------------- 8. back in the chat
export const back = {
  sessionClick: home.scopedClose + 0.9,
  chatIn: home.scopedClose + 1.1,
};
export const second = composerTurn(1, back.chatIn + 0.9);

export const T = {
  windowIn: 1.6,
  cursorIn: 2.2,
  ...docs,
  ...attach,
  marks: [first, second],
  plan,
  cal,
  cards,
  exam,
  home,
  back,
  introEnd: 1.6,
  outroStart: second.end + 4.5,
  total: second.end + 4.5 + 3.9,
};

/** the first question the student got wrong -- the graded view scrolls to its explanation */
export const FIRST_WRONG = EXAM_GRADED.questions.findIndex((q) => q.is_correct === false);
export { CARDS, TURNS };
export type { CapturedTurn };
