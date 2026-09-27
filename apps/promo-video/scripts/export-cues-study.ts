// Cue sheet for the study-plan film, derived from the SAME timeline and cursor script the video is
// rendered from (so sound can never drift from picture). Consumed by make_audio.py.
//
// Key clicks for the two typed messages and the calendar event's title, an upload rise and landing
// chime, message pops and tool ticks, a soft hum while the study session is built and a chime when
// it is ready, a soft whoosh as each panel opens, a snap for every card flip and exam answer, a
// success ding for a card rated Good/Easy, and a final ding when the exam is graded.
import { typedText } from "../src/study/data";
import { CLICKS } from "../src/study/script";
import { EVENT_TITLE, T, TYPE_CPS } from "../src/study/timeline";

const keys: { t: number; space: boolean }[] = [];
for (const m of T.marks) {
  const text = typedText(m.typed);
  for (let k = 1; k <= text.length; k++) {
    const t = m.typeStart + k / TYPE_CPS;
    if (t < m.sendClick) keys.push({ t, space: text[k - 1] === " " });
  }
}
for (let k = 1; k <= EVENT_TITLE.length; k++) {
  const t = T.cal.titleTypeStart + k / 18;
  if (t < T.cal.titleTypeEnd + 0.05) keys.push({ t, space: EVENT_TITLE[k - 1] === " " });
}

// The study-session turn: the build is the start_study_session tool (time-lapsed).
const session = T.marks[0];
const build = session.tools.find((x) => x.tool === "start_study_session") ?? session.tools[session.tools.length - 1]!;
const pings: number[] = [];
for (let t = build.start + 0.6; t < build.done - 0.6; t += 1.4) pings.push(t);

const panelOpens = [T.plan.open, T.cal.open, T.cards.open, T.exam.open, T.home.scopedOpen];
const panelCloses = [T.plan.close, T.cal.close, T.cards.close, T.exam.close, T.home.scopedClose];

const cues = {
  duration: T.total,
  keys,
  clicks: CLICKS.map((c) => c.t),
  pops: T.marks.flatMap((m) => [m.userAppear, m.asstAppear]),
  chipTicks: T.marks.flatMap((m) => m.tools.map((x) => x.start)),
  dings: [T.exam.graded],
  snaps: [
    T.pickerClick + 0.1,
    ...Array.from({ length: T.cards.ratings.length }, (_, i) => T.cards.reveal(i) + 0.05),
    T.home.scopedOpen + 1.75,
    ...Array.from({ length: 5 }, (_, i) => T.exam.answer(i) + 0.05),
    T.cal.addClick + 0.05,
  ],
  correct: T.cards.ratings.map((r, i) => (r >= 3 ? T.cards.rate(i) + 0.08 : -1)).filter((t) => t > 0),
  uploadRises: [{ t: T.uploadClick + 0.1, dur: T.uploadDone - T.uploadClick - 0.1 }],
  uploadDones: [T.uploadDone],
  pings,
  blips: [],
  pageTurns: [T.home.navClick + 0.1],
  readyChime: build.done + 0.05,
  whooshes: [
    { t: 0.4, dur: 0.8, dir: "in" },
    { t: T.windowIn, dur: 0.9, dir: "in" },
    ...panelOpens.map((t) => ({ t, dur: 0.35, dir: "in" })),
    ...panelCloses.map((t) => ({ t, dur: 0.3, dir: "out" })),
    { t: T.outroStart, dur: 0.8, dir: "out" },
  ],
  building: { start: build.start, end: build.done },
  bpm: 76,
  transpose: 2,
  musicGain: 0.4,
  arpEvery: 2,
  introAt: 0.25,
  outroAt: T.outroStart + 0.9,
};
process.stdout.write(JSON.stringify(cues));
