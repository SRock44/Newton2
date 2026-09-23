import type { Keyframe } from "../anim";
import type { Click, CursorKey } from "../engine";
import { T, artifactTimes } from "./timeline";

// The cursor's route, the camera, and the captions for the engineer film. Pure data derived
// from the timeline (no React), so the soundtrack exporter reads the very same clicks.

const A = T.artifact;
const M = T.marks;

const keys: CursorKey[] = [];
export const CLICKS: Click[] = [];

const at = (t: number, target: string, fb = { x: 1000, y: 600 }) => keys.push({ t, at: target, fb });
const pt = (t: number, x: number, y: number) => keys.push({ t, at: { x, y }, fb: { x, y } });
const click = (t: number, target: string, fb?: { x: number; y: number }) => {
  at(t - 0.4, target, fb);
  at(t, target, fb);
  CLICKS.push({ t, target });
};

pt(T.cursorIn, 1500, 780);
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
    pt(m.userAppear + 1.4, 1330, 600);
  } else if (m.kind === "stepcheck") {
    click(m.clickField!, "sc-field", { x: 900, y: 600 });
    click(m.sendClick, "sc-submit", { x: 1200, y: 600 });
    pt(m.userAppear + 1.4, 1330, 600);
  } else {
    click(m.sendClick, "buildit", { x: 700, y: 700 });
    pt(m.sendClick + 1.6, 1330, 620);
  }
  if (m.k === 3) {
    click(A.expandClick, "expand", { x: 1450, y: 190 });
    click(artifactTimes.cantClick, "art:cant", { x: 1000, y: 260 });
    at(artifactTimes.lDragStart, "art:inL", { x: 900, y: 700 });
    at(artifactTimes.lDragEnd, "art:inL", { x: 1200, y: 700 });
    at(artifactTimes.pDragStart, "art:inP", { x: 900, y: 760 });
    at(artifactTimes.pDragEnd, "art:inP", { x: 1200, y: 760 });
    click(artifactTimes.simplyClick, "art:simply", { x: 900, y: 260 });
    pt(A.end + 0.6, 1330, 640);
  }
}

// strictly increasing times
keys.sort((a, b) => a.t - b.t);
for (let i = 1; i < keys.length; i++) if (keys[i].t <= keys[i - 1].t) keys[i].t = keys[i - 1].t + 0.001;
export const CURSOR: CursorKey[] = keys;

// ------------------------------------------------------------------------- camera
export const Z: Keyframe<number>[] = [
  { t: 0, v: 1 },
  { t: T.uploadClick - 0.4, v: 1 },
  { t: T.uploadClick + 0.6, v: 1.07 },
  { t: T.uploadDone + 1.6, v: 1.07 },
  { t: T.newChatClick, v: 1 },
  { t: T.composerClick - 0.4, v: 1.03 },
  { t: A.expandClick - 0.5, v: 1.03 },
  { t: A.expandClick + 0.7, v: 1.1 },
  { t: A.end + 0.4, v: 1.1 },
  { t: A.end + 1.5, v: 1.03 },
  { t: T.outroStart, v: 1.03 },
  { t: T.outroStart + 1.2, v: 1 },
  { t: T.total, v: 1 },
];
export const FX: Keyframe<number>[] = [
  { t: 0, v: 960 },
  { t: T.uploadClick, v: 1000 },
  { t: T.total, v: 1000 },
];
// Zoom toward the bottom edge so the window's bottom never rides up under the caption.
export const FY: Keyframe<number>[] = [{ t: 0, v: 940 }, { t: T.total, v: 940 }];

// ------------------------------------------------------------------------ captions
export const CAPTIONS = [
  { from: T.navClick - 0.3, to: T.newChatClick - 0.4, text: "Add your slides to Newton Documents." },
  { from: T.learnClick - 0.3, to: T.plusClick - 0.2, text: "Learn Mode: Newton teaches, it doesn't just tell." },
  { from: T.plusClick - 0.1, to: M[0].asstAppear - 0.2, text: "Attach them to a chat — straight from Documents." },
  { from: M[0].asstAppear, to: M[1].clickField! - 0.2, text: "Newton checks the numbers with real computation." },
  { from: M[1].clickField!, to: M[2].clickField! - 0.2, text: "Then it hands the next step back to you." },
  { from: M[2].clickField!, to: A.end, text: "Ask for a visual. Approve the plan. Explore it." },
  { from: M[4].clickField!, to: M[5].end + 1.0, text: "Push back — Newton shows its work and holds its ground." },
  { from: M[6].clickField!, to: M[7].end + 1.6, text: "Ask for the answer? Newton makes you get there." },
];
