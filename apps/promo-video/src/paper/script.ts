import type { Keyframe } from "../anim";
import type { Click, CursorKey } from "../engine";
import { T, VIEWER_MOVE, viewerStops } from "./timeline";

// The cursor's route, the camera, and the captions for the research film. Pure data derived from
// the timeline (no React), so the soundtrack exporter reads the very same clicks.

const M = T.marks;
const P = T.paper;

const keys: CursorKey[] = [];
export const CLICKS: Click[] = [];

const at = (t: number, target: string, fb = { x: 1000, y: 600 }) => keys.push({ t, at: target, fb });
const pt = (t: number, x: number, y: number) => keys.push({ t, at: { x, y }, fb: { x, y } });
const click = (t: number, target: string, fb?: { x: number; y: number }) => {
  at(t - 0.4, target, fb);
  at(t, target, fb);
  CLICKS.push({ t, target });
};

pt(T.cursorIn, 1500, 720);
// ---- Documents: upload the notes, read them, upload the synopsis
click(T.navClick, "nav-documents", { x: 300, y: 830 });
click(T.up1Click, "upload-btn", { x: 1450, y: 190 });
at(T.up1Done + 0.7, "doc-card", { x: 700, y: 330 });
at(T.up1Done + 1.9, "doc-detail", { x: 1100, y: 520 });
click(T.up2Click, "upload-btn", { x: 1450, y: 190 });
at(T.up2Done + 0.7, "doc-card", { x: 700, y: 330 });
at(T.up2Done + 1.9, "doc-detail", { x: 1100, y: 520 });
click(T.newChatClick, "newchat", { x: 330, y: 270 });
// ---- attach the synopsis from Documents
click(T.plusClick, "plus", { x: 700, y: 880 });
click(T.menuExistingClick, "menu-existing", { x: 800, y: 800 });
click(T.pickerClick, "picker-deck", { x: 800, y: 760 });

for (const m of M) {
  if (m.kind === "composer") {
    if (m.preClick !== undefined) click(m.preClick, "plan-changes", { x: 1280, y: 700 });
    click(m.clickField!, "composer", { x: 900, y: 890 });
    click(m.sendClick, "send", { x: 1430, y: 890 });
  } else {
    click(m.sendClick, "plan-approve", { x: 1100, y: 700 });
  }
  if (m.planPan) pt(m.planPan.from, 1330, 620); // rest while the plan is read
  else pt(m.userAppear + 1.3, 1330, 600);
}

// ---- the finished paper, in Documents
click(P.nav2Click, "nav-documents", { x: 300, y: 830 });
click(P.cardClick, "doc-card", { x: 700, y: 330 });
click(P.downloadClick, "doc-download", { x: 1450, y: 210 });
pt(P.viewerIn + 1.2, 1300, 640); // rests over the viewer

keys.sort((a, b) => a.t - b.t);
for (let i = 1; i < keys.length; i++) if (keys[i].t <= keys[i - 1].t) keys[i].t = keys[i - 1].t + 0.001;
export const CURSOR: CursorKey[] = keys;

// ------------------------------------------------------------------------- camera
export const Z: Keyframe<number>[] = [
  { t: 0, v: 1 },
  { t: T.up1Click - 0.4, v: 1 },
  { t: T.up1Click + 0.6, v: 1.06 },
  { t: T.newChatClick - 0.4, v: 1.06 },
  { t: T.newChatClick, v: 1 },
  { t: T.composerClick - 0.4, v: 1.03 },
  { t: P.nav2Click - 0.4, v: 1.03 },
  { t: P.nav2Click + 0.6, v: 1.06 },
  { t: P.viewerIn, v: 1.06 },
  { t: P.viewerIn + 1.0, v: 1 },
  { t: T.outroStart, v: 1 },
  { t: T.total, v: 1 },
];
export const FX: Keyframe<number>[] = [
  { t: 0, v: 960 },
  { t: T.up1Click, v: 1000 },
  { t: T.total, v: 1000 },
];
// Zoom toward the bottom edge so the window's bottom never rides up under the caption.
export const FY: Keyframe<number>[] = [{ t: 0, v: 940 }, { t: T.total, v: 940 }];

// ------------------------------------------------------------------------ captions
export const CAPTIONS = [
  { from: T.navClick - 0.3, to: T.newChatClick - 0.4, text: "Drop in your raw lab notes and your project synopsis." },
  { from: T.plusClick - 0.1, to: M[0].asstAppear - 0.2, text: "Attach what Newton should write from." },
  { from: M[0].asstAppear, to: M[1].preClick! - 0.2, text: "Newton plans an arXiv-style paper — from what your notes actually show." },
  { from: M[1].preClick!, to: M[2].sendClick - 0.2, text: "Push back on the plan. Newton revises it." },
  { from: M[2].sendClick, to: M[2].end, text: "Approve: real sources found, real LaTeX written and compiled." },
  { from: P.nav2Click, to: P.viewerIn - 0.3, text: "Saved to your Documents: the PDF and its LaTeX source." },
  { from: P.viewerIn + 0.2, to: T.viewerOut, text: "A real arXiv-style paper: equations, tables, and cited sources." },
];

export { VIEWER_MOVE, viewerStops };
