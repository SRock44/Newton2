// All times in seconds. One continuous take: intro -> study mode -> Notepad in class ->
// artifact (plan, approve, build, interact) -> outro.
export const T = {
  windowIn: 2.0,

  // Scene 1 — study mode
  s1CursorIn: 2.7,
  s1ComposerClick: 3.4,
  s1TypeStart: 3.6,
  s1TypeCps: 40,
  s1SendClick: 6.15,
  s1UserMsg: 6.3,
  s1AssistantIn: 6.75,
  s1ChipStart: [6.95, 7.55, 8.15],
  s1ChipDone: [7.45, 8.05, 8.65],
  s1ReplyStart: 8.85,
  s1ReplyDur: 3.4,
  s1End: 13.3,

  // Scene 2 — Notepad in class
  nbIn: 13.4,
  nbInDur: 0.9,
  nbBodyClick: 15.0,
  nbTypeStart: 15.3,
  nbTypeCps: 9,
  nbPreviewClick: 17.5,
  nbSelStart: 18.15,
  nbSelDur: 0.7,
  nbToolbarIn: 18.9,
  nbDefineClick: 20.05,
  nbDefineShown: 20.2,
  nbOut: 22.7,
  nbOutDur: 0.7,

  // Scene 3 — artifact
  newChatClick: 23.7,
  s3ComposerClick: 24.4,
  s3TypeStart: 24.6,
  s3TypeCps: 36,
  s3SendClick: 26.5,
  s3UserMsg: 26.65,
  s3AssistantIn: 27.1,
  s3IntroCps: 110,
  s3PlanAt: 28.7,
  s3TailStart: 29.0,
  s3TailCps: 260,
  s3BuildClick: 32.35,
  s3BuildMsg: 32.5,
  s3BuildChipStart: 32.95,
  s3ArtifactAt: 36.95,
  s3ExpandClick: 38.3,
  s3GrabAt: 40.0,
  s3DragEnd: 44.6,

  // Outro
  outroStart: 46.0,
  total: 49.5,
};

export const NEWCHAT_FALLBACK = { x: 260, y: 300 };
