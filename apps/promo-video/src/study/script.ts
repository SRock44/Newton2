import type { Keyframe } from "../anim";
import type { Click, CursorKey } from "../engine";
import { T } from "./timeline";

// The cursor's route, the camera, and the captions for the study-plan film. Pure data derived from
// the timeline (no React), so the soundtrack exporter reads the very same clicks.

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

pt(T.cursorIn, 1500, 720);
// ---- Documents: upload the packet, read it
click(T.navClick, "nav-documents", { x: 300, y: 830 });
click(T.uploadClick, "upload-btn", { x: 1450, y: 190 });
at(T.uploadDone + 0.7, "doc-card", { x: 700, y: 330 });
at(T.detailLook, "doc-detail", { x: 1100, y: 520 });
click(T.newChatClick, "newchat", { x: 330, y: 270 });
// ---- attach it, ask
click(T.plusClick, "plus", { x: 700, y: 880 });
click(T.menuExistingClick, "menu-existing", { x: 800, y: 800 });
click(T.pickerClick, "picker-deck", { x: 800, y: 760 });
click(M[0].clickField, "composer", { x: 900, y: 890 });
click(M[0].sendClick, "send", { x: 1430, y: 890 });
pt(M[0].userAppear + 1.3, 1330, 600);

// ---- Study plan
click(T.plan.navClick, "nav-plan", { x: 300, y: 780 });
at(T.plan.hoverFirst, "plan-first", { x: 960, y: 380 });
at(T.plan.hoverMidterm, "plan-last", { x: 960, y: 700 });
click(T.plan.closeClick, "modal-close", { x: 1230, y: 200 });

// ---- Calendar
click(T.cal.navClick, "nav-cal", { x: 300, y: 810 });
at(T.cal.hoverDeadline, "cal-deadline", { x: 960, y: 520 });
click(T.cal.newEventClick, "cal-new", { x: 960, y: 330 });
click(T.cal.titleTypeStart - 0.1, "cal-title", { x: 960, y: 380 });
at(T.cal.startSet, "cal-start", { x: 900, y: 470 });
click(T.cal.addClick, "cal-add", { x: 1150, y: 640 });
at(T.cal.added + 1.0, "cal-deadline", { x: 960, y: 500 });
click(T.cal.closeClick, "modal-close", { x: 1230, y: 200 });

// ---- Flashcards
click(T.cards.navClick, "nav-cards", { x: 300, y: 845 });
for (let i = 0; i < T.cards.ratings.length; i++) {
  at(T.cards.start(i) + 0.4, "card-box", { x: 960, y: 480 });
  click(T.cards.reveal(i), "card-box", { x: 960, y: 480 });
  click(T.cards.rate(i), `rate-${T.cards.ratings[i]}`, { x: 960, y: 640 });
}
click(T.cards.browseClick, "tab-all", { x: 1000, y: 300 });
at(T.cards.browse + 1.8, "export-anki", { x: 1000, y: 300 });
click(T.cards.closeClick, "modal-close", { x: 1230, y: 200 });

// ---- Practice exam
click(T.exam.navClick, "nav-exams", { x: 300, y: 875 });
click(T.exam.examClick, "exam-title", { x: 900, y: 300 });
for (let i = 0; i < 5; i++) click(T.exam.answer(i), `exam-choice-${i}`, { x: 900, y: 420 + i * 30 });
pt(T.exam.scrollStart + 0.6, 1230, 470);
click(T.exam.submitClick, "exam-submit", { x: 960, y: 760 });
at(T.exam.explainStart + 0.9, "exam-explain", { x: 960, y: 520 });
click(T.exam.closeClick, "modal-close", { x: 1230, y: 200 });

// ---- Home
click(T.home.navClick, "nav-home", { x: 270, y: 100 });
at(T.home.hoverDue, "home-due", { x: 900, y: 300 });
at(T.home.hoverWeak, "home-weak", { x: 1100, y: 500 });
click(T.home.reviewClick, "home-review", { x: 1000, y: 640 });
at(T.home.scopedOpen + 1.1, "card-box", { x: 960, y: 480 });
click(T.home.scopedOpen + 1.7, "card-box", { x: 960, y: 480 });
click(T.home.closeClick, "modal-close", { x: 1230, y: 200 });

// ---- back in the chat, ask where to focus
click(T.back.sessionClick, "session-first", { x: 300, y: 290 });
click(M[1].clickField, "composer", { x: 900, y: 890 });
click(M[1].sendClick, "send", { x: 1430, y: 890 });
pt(M[1].userAppear + 1.3, 1330, 600);

keys.sort((a, b) => a.t - b.t);
for (let i = 1; i < keys.length; i++) if (keys[i].t <= keys[i - 1].t) keys[i].t = keys[i - 1].t + 0.001;
export const CURSOR: CursorKey[] = keys;

// ------------------------------------------------------------------------- camera
// Zoom in on each panel as it opens (its text is small at window scale), out as it closes. The
// practice exam is nearly window-tall, so it only nudges in.
const ZOOMS: { open: number; close: number; z: number }[] = [
  { open: T.plan.open, close: T.plan.close, z: 1.14 },
  { open: T.cal.open, close: T.cal.close, z: 1.14 },
  { open: T.cards.open, close: T.cards.close, z: 1.2 },
  { open: T.exam.open, close: T.exam.close, z: 1.14 },
  { open: T.home.scopedOpen, close: T.home.scopedClose, z: 1.2 },
];
export const Z: Keyframe<number>[] = [{ t: 0, v: 1 }, { t: T.composerClick - 0.4, v: 1 }, { t: T.composerClick, v: 1.03 }];
for (const w of ZOOMS) {
  Z.push({ t: w.open - 0.4, v: Z[Z.length - 1]!.v });
  Z.push({ t: w.open + 0.6, v: w.z });
  Z.push({ t: w.close - 0.1, v: w.z });
  Z.push({ t: w.close + 0.6, v: 1 });
}
Z.push({ t: T.outroStart, v: 1 }, { t: T.total, v: 1 });
// keyframes must be strictly ascending
for (let i = 1; i < Z.length; i++) if (Z[i]!.t <= Z[i - 1]!.t) Z[i]!.t = Z[i - 1]!.t + 0.001;
export const FX: Keyframe<number>[] = [{ t: 0, v: 960 }, { t: T.total, v: 960 }];
// Zoom toward the vertical middle of the window so a panel stays centred and clear of the caption.
export const FY: Keyframe<number>[] = [{ t: 0, v: 470 }, { t: T.total, v: 470 }];

// ------------------------------------------------------------------------ captions
export const CAPTIONS = [
  { from: T.navClick - 0.3, to: T.newChatClick - 0.4, text: "Drop in your Midterm 2 packet: the schedule and the five techniques." },
  { from: T.plusClick - 0.1, to: M[0].asstAppear - 0.2, text: "Attach it and ask Newton to get you ready." },
  { from: M[0].asstAppear, to: M[0].revealStart, text: "One request. Newton builds a whole study session." },
  { from: M[0].revealStart, to: T.plan.navClick - 0.2, text: "A dated plan, flashcards and a practice exam, all from your own packet." },
  { from: T.plan.navClick, to: T.plan.close, text: "Study plan: every deadline, with its real date." },
  { from: T.cal.navClick, to: T.cal.newEventClick - 0.2, text: "They land on your calendar too." },
  { from: T.cal.newEventClick, to: T.cal.close, text: "Add your own study blocks right beside them." },
  { from: T.cards.navClick, to: T.cards.browseClick - 0.2, text: "Flashcards, scheduled by spaced repetition." },
  { from: T.cards.browseClick, to: T.cards.close, text: "Export to Anki or PowerPoint, or share a link." },
  { from: T.exam.navClick, to: T.exam.submitClick - 0.2, text: "Take the practice exam." },
  { from: T.exam.submitClick, to: T.exam.close, text: "Graded, with an explanation for every miss." },
  { from: T.home.navClick, to: T.home.reviewClick - 0.2, text: "Home shows what to study next, from your real results." },
  { from: T.home.reviewClick, to: T.home.scopedClose, text: "One click reviews exactly the cards you struggled with." },
  { from: M[1].clickField, to: M[1].asstAppear - 0.2, text: "Then ask Newton where to focus." },
  { from: M[1].asstAppear, to: T.outroStart, text: "It answers from your actual performance." },
];
