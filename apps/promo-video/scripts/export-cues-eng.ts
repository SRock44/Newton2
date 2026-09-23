// Cue sheet for the engineer film, derived from the SAME timeline and cursor script the video
// is rendered from (so sound can never drift from picture). Consumed by make_audio.py.
import { typedText } from "../src/eng/data";
import { CLICKS } from "../src/eng/script";
import { T, TYPE_CPS, STEP_DELAY, artifactTimes, artifactState } from "../src/eng/timeline";

const keys: { t: number; space: boolean }[] = [];
for (const m of T.marks) {
  if (m.kind === "composer" && m.typed !== undefined) {
    const text = typedText(m.typed);
    for (let k = 1; k <= text.length; k++) {
      const t = m.typeStart! + k / TYPE_CPS;
      if (t < m.sendClick) keys.push({ t, space: text[k - 1] === " " });
    }
  } else if (m.kind === "stepcheck") {
    // math-field entry: one keystroke per token typed
    (m.latexSteps ?? []).forEach((_, i) => {
      const t = m.typeStart! + i * STEP_DELAY;
      if (t < m.sendClick) keys.push({ t, space: false });
    });
  }
}

// The sliders are heard as a soft tone whose pitch follows the value being dragged.
const seg = (a: number, b: number, key: "L" | "P", lo: number, hi: number) => {
  const out: [number, number][] = [];
  for (let t = a; t <= b; t += 1 / 30) out.push([t, ((artifactState(t)[key] - lo) / (hi - lo)) * 360]);
  return out;
};

const build = T.marks[3];
const chip = build.tools[build.tools.length - 1];

const cues = {
  duration: T.total,
  keys,
  clicks: CLICKS.map((c) => c.t),
  pops: T.marks.flatMap((m) => [m.userAppear, m.asstAppear]),
  chipTicks: T.marks.flatMap((m) => m.tools.map((x) => x.start)),
  dings: [T.uploadDone, ...T.marks.flatMap((m) => m.tools.filter((x) => x.tool !== "create_artifact").map((x) => x.done))],
  readyChime: build.blockAt!,
  whooshes: [
    { t: 0.4, dur: 0.8, dir: "in" },
    { t: T.windowIn, dur: 0.9, dir: "in" },
    { t: T.outroStart, dur: 0.8, dir: "out" },
  ],
  building: { start: chip.start, end: chip.done },
  dragSegments: [
    seg(artifactTimes.lDragStart, artifactTimes.lDragEnd, "L", 1, 3),
    seg(artifactTimes.pDragStart, artifactTimes.pDragEnd, "P", 1, 20),
  ],
  introAt: 0.25,
  outroAt: T.outroStart + 0.9,
};
process.stdout.write(JSON.stringify(cues));
