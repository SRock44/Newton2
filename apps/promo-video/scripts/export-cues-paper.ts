// Cue sheet for the research film, derived from the SAME timeline and cursor script the video is
// rendered from (so sound can never drift from picture). Consumed by make_audio.py.
//
// Uploads rise and land, the attach snaps, plan and reply messages pop, source lookups blip, a soft
// hum runs while the paper is written and a chime marks it done, and a soft whoosh marks the
// document panel opening and the highlight sweeping in.
import { typedText } from "../src/paper/data";
import { CLICKS } from "../src/paper/script";
import { T, TYPE_CPS } from "../src/paper/timeline";

const RP = T.reviewPanel;

const keys: { t: number; space: boolean }[] = [];
for (const m of T.marks) {
  if (m.kind === "composer" && m.typed !== undefined) {
    const text = typedText(m.typed);
    for (let k = 1; k <= text.length; k++) {
      const t = m.typeStart! + k / TYPE_CPS;
      if (t < m.sendClick) keys.push({ t, space: text[k - 1] === " " });
    }
  }
}

// The "Approve & Write" turn specifically (marks[2]) -- NOT the last mark, which is now the
// review follow-up (marks[3]).
const write = T.marks[2];
const wTools = write.tools;
const wStart = wTools[0].start;
const wEnd = wTools[wTools.length - 1].done;
const searchTools = wTools.filter((x) => x.tool === "web_search" || x.tool === "research_fetch");
const pings: number[] = [];
for (let t = wStart + 0.6; t < wEnd - 0.6; t += 1.4) pings.push(t);

const cues = {
  duration: T.total,
  keys,
  clicks: CLICKS.map((c) => c.t),
  pops: T.marks.flatMap((m) => [m.userAppear, m.asstAppear]),
  chipTicks: T.marks.flatMap((m) => m.tools.map((x) => x.start)),
  dings: [],
  snaps: [T.pickerClick + 0.1, T.picker2Click + 0.1, RP.askClick + 0.1],
  uploadRises: [
    { t: T.up1Click + 0.1, dur: T.up1Done - T.up1Click - 0.1 },
    { t: T.up2Click + 0.1, dur: T.up2Done - T.up2Click - 0.1 },
  ],
  uploadDones: [T.up1Done, T.up2Done],
  pings,
  blips: searchTools.map((x) => x.start),
  // Reuses the same soft "page turn" whoosh for the highlight sweeping in over the real sentence.
  pageTurns: [RP.highlightStart],
  readyChime: wEnd + 0.05,
  whooshes: [
    { t: 0.4, dur: 0.8, dir: "in" },
    { t: T.windowIn, dur: 0.9, dir: "in" },
    { t: RP.panelIn, dur: RP.panelInDur, dir: "in" },
    { t: T.outroStart, dur: 0.8, dir: "out" },
  ],
  building: { start: wStart, end: wEnd },
  bpm: 76,
  transpose: 2,
  musicGain: 0.4,
  arpEvery: 2,
  introAt: 0.25,
  outroAt: T.outroStart + 0.9,
};
process.stdout.write(JSON.stringify(cues));
