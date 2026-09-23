// Prints the soundtrack's cue sheet as JSON, derived from the SAME timeline the video is
// rendered from (so sound can never drift from picture). Consumed by make_audio.py.
import * as D from "../src/data";
import { T } from "../src/timeline";
import { dragAngle } from "../src/drag";

const typing = (text: string, start: number, cps: number, until: number) => {
  const out: { t: number; space: boolean }[] = [];
  for (let k = 1; k <= text.length; k++) {
    const t = start + k / cps;
    if (t < until) out.push({ t, space: text[k - 1] === " " });
  }
  return out;
};

const keys = [
  ...typing(D.STUDY_PROMPT, T.s1TypeStart, T.s1TypeCps, T.s1SendClick),
  ...typing(D.NOTE_WORD, T.nbTypeStart, T.nbTypeCps, T.nbPreviewClick),
  ...typing(D.ARTIFACT_PROMPT, T.s3TypeStart, T.s3TypeCps, T.s3SendClick),
];

const drag: [number, number][] = [];
for (let t = T.s3GrabAt; t <= T.s3DragEnd; t += 1 / 30) drag.push([t, dragAngle(t)]);

const cues = {
  duration: T.total,
  keys,
  clicks: [
    T.s1ComposerClick, T.s1SendClick, T.nbBodyClick, T.nbPreviewClick, T.nbDefineClick,
    T.newChatClick, T.s3ComposerClick, T.s3SendClick, T.s3BuildClick, T.s3ExpandClick, T.s3GrabAt,
  ],
  pops: [T.s1UserMsg, T.s1AssistantIn, T.nbToolbarIn, T.s3UserMsg, T.s3AssistantIn, T.s3PlanAt, T.s3BuildMsg],
  chipTicks: [...T.s1ChipStart, T.s3BuildChipStart],
  dings: T.s1ChipDone,
  defineChime: T.nbDefineShown,
  readyChime: T.s3ArtifactAt,
  whooshes: [
    { t: T.windowIn, dur: 0.8, dir: "in" },
    { t: T.nbIn, dur: T.nbInDur, dir: "in" },
    { t: T.nbOut, dur: T.nbOutDur, dir: "out" },
    { t: T.outroStart, dur: 0.8, dir: "out" },
  ],
  selection: { t: T.nbSelStart, dur: T.nbSelDur },
  building: { start: T.s3BuildChipStart, end: T.s3ArtifactAt },
  drag,
  introAt: 0.25,
  outroAt: T.outroStart + 0.9,
};
process.stdout.write(JSON.stringify(cues));
