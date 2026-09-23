import type { Keyframe } from "../anim";
import type { Click, CursorKey } from "../engine";
import { T, tagTimes } from "./timeline";

// The cursor's route, the camera, and the captions for the showcase film. Pure data derived
// from the timeline (no React), so the soundtrack exporter reads the very same clicks.

const M = T.marks;
const nb = T.nb;

/** Where the Notepad's controls sit, in the film's canvas units (used as fallbacks while the
 * window is in another phase). */
const NBPT = {
  row: { x: 1342, y: 361 },
  newBtn: { x: 1359, y: 180 },
  title: { x: 1396, y: 177 },
  tagIcon: { x: 1598, y: 169 },
  tagInput: { x: 1400, y: 277 },
  tagDone: { x: 1599, y: 277 },
  body: { x: 1520, y: 345 },
};

const keys: CursorKey[] = [];
export const CLICKS: Click[] = [];

const at = (t: number, target: string, fb = { x: 1000, y: 600 }) => keys.push({ t, at: target, fb });
const pt = (t: number, x: number, y: number) => keys.push({ t, at: { x, y }, fb: { x, y } });
const click = (t: number, target: string, fb?: { x: number; y: number }) => {
  at(t - 0.4, target, fb);
  at(t, target, fb);
  CLICKS.push({ t, target });
};

// ---- Notepad: click into the note, type (it is formatted as it is written), highlight a word ->
// Define, highlight the formula -> Explain
pt(nb.cursorIn, 1500, 720);
// the notes list, then a new note: name it, tag it. The controls live in different phases of the
// window, so each keeps a fallback at the spot it occupies (the cursor rests there in between).
at(nb.listHover, "nb-list-row", NBPT.row);
click(nb.newNoteClick, "nb-new", NBPT.newBtn);
click(nb.titleClick, "nb-title", NBPT.title);
click(nb.tagIconClick, "nb-tag-icon", NBPT.tagIcon);
pt(tagTimes[tagTimes.length - 1].enter + 0.1, NBPT.tagInput.x, NBPT.tagInput.y);
click(nb.tagDone, "nb-tag-done", NBPT.tagDone);
// click into the empty part of the note (to the right of where the text will go, so the pointer
// never sits on top of what is being typed) and stay there while it is typed
pt(nb.bodyClick - 0.4, NBPT.body.x, NBPT.body.y);
pt(nb.bodyClick, NBPT.body.x, NBPT.body.y);
CLICKS.push({ t: nb.bodyClick, target: "nb-body" });
pt(nb.typeEnd, NBPT.body.x, NBPT.body.y);
at(nb.selTermStart - 0.5, "nb-term-start", { x: 1250, y: 420 });
at(nb.selTermStart + nb.selDur, "nb-term-end", { x: 1330, y: 420 });
click(nb.defineClick, "nb-define", { x: 1300, y: 380 });
at(nb.selFormulaStart - 0.5, "nb-formula-start", { x: 1180, y: 320 });
at(nb.selFormulaStart + nb.selDur, "nb-formula-end", { x: 1400, y: 320 });
click(nb.explainClick, "nb-explain", { x: 1250, y: 300 });
pt(nb.nbOut + 0.3, 1250, 620);

// ---- Documents: upload the handout, open it, start a new chat, Learn Mode, attach from Documents
click(T.navClick, "nav-documents", { x: 300, y: 830 });
click(T.uploadClick, "upload-btn", { x: 1450, y: 190 });
at(T.uploadDone + 0.6, "doc-card", { x: 700, y: 330 });
at(T.uploadDone + 1.7, "doc-detail", { x: 1100, y: 520 });
click(T.newChatClick, "newchat", { x: 330, y: 270 });
click(T.learnClick, "learn", { x: 700, y: 820 });
click(T.plusClick, "plus", { x: 700, y: 880 });
click(T.menuExistingClick, "menu-existing", { x: 800, y: 800 });
click(T.pickerDeckClick, "picker-deck", { x: 800, y: 760 });

for (const m of M) {
  if (m.kind === "composer") {
    click(m.clickField!, "composer", { x: 900, y: 890 });
    click(m.sendClick, "send", { x: 1430, y: 890 });
  } else if (m.kind === "stepcheck") {
    click(m.clickField!, "sc-field", { x: 900, y: 600 });
    click(m.sendClick, "sc-submit", { x: 1200, y: 600 });
  } else {
    click(m.clickField!, "cp-field", { x: 900, y: 600 });
    click(m.sendClick, "cp-submit", { x: 1200, y: 600 });
  }
  pt(m.userAppear + 1.3, 1330, 600);
}

// strictly increasing times
keys.sort((a, b) => a.t - b.t);
for (let i = 1; i < keys.length; i++) if (keys[i].t <= keys[i - 1].t) keys[i].t = keys[i - 1].t + 0.001;
export const CURSOR: CursorKey[] = keys;

// ------------------------------------------------------------------------- camera
export const Z: Keyframe<number>[] = [
  { t: 0, v: 1 },
  { t: nb.nbIn - 0.2, v: 1 },
  { t: nb.nbIn + 1.1, v: 1.06 },
  { t: nb.nbOut, v: 1.06 },
  { t: nb.nbOut + 0.9, v: 1 },
  { t: T.navClick, v: 1 },
  { t: T.uploadClick + 0.6, v: 1.07 },
  { t: T.uploadDone + 1.6, v: 1.07 },
  { t: T.newChatClick, v: 1 },
  { t: T.composerClick - 0.4, v: 1.03 },
  { t: T.outroStart, v: 1.03 },
  { t: T.outroStart + 1.2, v: 1 },
  { t: T.total, v: 1 },
];
export const FX: Keyframe<number>[] = [
  { t: 0, v: 960 },
  { t: nb.nbIn - 0.2, v: 960 },
  { t: nb.nbIn + 1.1, v: 1400 },
  { t: nb.nbOut, v: 1400 },
  { t: nb.nbOut + 0.9, v: 960 },
  { t: T.uploadClick, v: 1000 },
  { t: T.total, v: 1000 },
];
// Zoom toward the bottom edge so the window's bottom never rides up under the caption.
export const FY: Keyframe<number>[] = [{ t: 0, v: 940 }, { t: T.total, v: 940 }];

// ------------------------------------------------------------------------ captions
export const CAPTIONS = [
  { from: nb.nbIn + 0.5, to: nb.newNoteClick - 0.2, text: "The Notepad: your notes from every class, tagged by topic." },
  { from: nb.newNoteClick, to: nb.bodyClick - 0.2, text: "Start a new note for today's lecture — name it, tag it." },
  { from: nb.bodyClick, to: nb.selTermStart - 0.2, text: "In class: take notes as you go." },
  { from: nb.selTermStart, to: nb.selFormulaStart - 0.2, text: "Highlight a term. Define it — right in your note." },
  { from: nb.selFormulaStart, to: nb.scrollStart - 0.2, text: "Highlight a formula. Have Newton explain it." },
  { from: nb.scrollStart, to: nb.nbOut, text: "Newton's answers live right in your note." },
  { from: T.navClick - 0.3, to: T.newChatClick - 0.4, text: "Upload your lecture handout to Newton Documents." },
  { from: T.learnClick - 0.3, to: T.plusClick - 0.2, text: "Learn Mode: Newton teaches — it doesn't just tell." },
  { from: T.plusClick - 0.1, to: M[0].asstAppear - 0.2, text: "Attach it to a chat, straight from Documents." },
  { from: M[0].asstAppear, to: M[2].clickField! - 0.2, text: "Type your answer. Newton checks it — and pushes back." },
  { from: M[2].clickField!, to: M[4].clickField! - 0.2, text: "Sign error? Newton catches it and sends you back to fix it." },
  { from: M[4].clickField!, to: M[5].clickField! - 0.2, text: "Explain it in your own words. Newton checks that you get it." },
  { from: M[5].clickField!, to: M[5].end + 0.6, text: "Newton Research: real sources, real citations." },
];
