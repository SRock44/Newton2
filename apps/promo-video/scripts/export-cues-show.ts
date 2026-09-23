// Cue sheet for the showcase film, derived from the SAME timeline and cursor script the video
// is rendered from (so sound can never drift from picture). Consumed by make_audio.py.
//
// Every product moment gets its own sound: Notepad writing (soft wooden ticks), highlight
// sweeps, a bright chime for Define and a warmer two-note for Explain, an upload rise + landing chime, the Learn Mode switch, the attach snap, a rising
// chime when Newton confirms an answer and a soft falling pair when it pushes back, and sonar
// pings + source blips while Newton Research works.
import { TURNS, noteState, typedText } from "../src/show/data";
import { CLICKS } from "../src/show/script";
import { NOTE_CPS, STEP_DELAY, T, TYPE_CPS } from "../src/show/timeline";

const nb = T.nb;
const keys: { t: number; space: boolean; kind?: "note" }[] = [];

// Notepad: the note as it is typed
const noteText = noteState(false, false).content;
for (let k = 1; k <= noteText.length; k++) {
  const t = nb.typeStart + k / NOTE_CPS;
  if (t < nb.typeEnd && noteText[k - 1] !== "\n") keys.push({ t, space: noteText[k - 1] === " ", kind: "note" });
}
// Chat: typed messages, math-field entry, checkpoint answers
for (const m of T.marks) {
  if ((m.kind === "composer" || m.kind === "checkpoint") && m.typed !== undefined) {
    const text = typedText(m.typed);
    for (let k = 1; k <= text.length; k++) {
      const t = m.typeStart! + k / TYPE_CPS;
      if (t < m.sendClick) keys.push({ t, space: text[k - 1] === " " });
    }
  } else if (m.kind === "stepcheck") {
    (m.latexSteps ?? []).forEach((_, i) => {
      const t = m.typeStart! + i * STEP_DELAY;
      if (t < m.sendClick) keys.push({ t, space: false });
    });
  }
}

// How Newton answered each turn decides its sound.
const CONFIRM = /^(Exactly|That's it|That's right|Yes|Perfect|Right|Nice)/i;
const NUDGE = /^(Close|Not quite|Good instinct|Almost)/i;
const correct: number[] = [];
const nudges: number[] = [];
for (const m of T.marks) {
  const reply = TURNS[2 * m.k + 1].content.trim();
  if (CONFIRM.test(reply)) correct.push(m.revealStart);
  else if (NUDGE.test(reply)) nudges.push(m.revealStart);
}

// Research: from the first research chip to the last chip finishing
const research = T.marks[T.marks.length - 1];
const rStart = research.tools[0].start;
const rEnd = research.tools[research.tools.length - 1].done;
const pings: number[] = [];
for (let t = rStart + 0.6; t < rEnd - 0.6; t += 1.3) pings.push(t);
const blips = research.tools.filter((x) => x.tool === "web_search" || x.tool === "research_fetch").map((x) => x.start);

const cues = {
  duration: T.total,
  keys,
  clicks: CLICKS.map((c) => c.t),
  pops: T.marks.flatMap((m) => [m.userAppear, m.asstAppear]),
  chipTicks: T.marks.flatMap((m) => m.tools.map((x) => x.start)),
  dings: T.marks.flatMap((m) => m.tools.filter((x) => x.tool === "symbolic_math").map((x) => x.done)),
  selections: [
    { t: nb.selTermStart, dur: nb.selDur },
    { t: nb.selFormulaStart, dur: nb.selDur },
  ],
  defineChimes: [nb.defineShown],
  explainChimes: [nb.explainShown],
  switches: [T.learnClick + 0.05],
  snaps: [T.pickerDeckClick + 0.1],
  uploadRises: [{ t: T.uploadClick + 0.1, dur: T.uploadDone - T.uploadClick - 0.1 }],
  uploadDones: [T.uploadDone],
  correct,
  nudges,
  pings,
  blips,
  readyChime: rEnd + 0.05,
  whooshes: [
    { t: 0.4, dur: 0.8, dir: "in" },
    { t: T.nb.windowIn, dur: 0.9, dir: "in" },
    { t: nb.nbIn, dur: nb.nbInDur, dir: "in" },
    { t: nb.nbOut, dur: nb.nbOutDur, dir: "out" },
    { t: T.outroStart, dur: 0.8, dir: "out" },
  ],
  building: { start: rStart, end: rEnd },
  bpm: 100,
  transpose: 2,
  introAt: 0.25,
  outroAt: T.outroStart + 0.9,
};
process.stdout.write(JSON.stringify(cues));
