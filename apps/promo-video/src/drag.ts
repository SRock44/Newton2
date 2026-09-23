import { track, type Keyframe } from "./anim";
import { T } from "./timeline";

// The angle the artifact's point is dragged to over time. Shared by the composition (what
// is drawn) and the soundtrack (the pitch of the drag tone follows the same curve).
export const DRAG_KEYFRAMES: Keyframe<number>[] = [
  { t: T.s3GrabAt, v: 30 },
  { t: T.s3GrabAt + 1.3, v: 120 },
  { t: T.s3GrabAt + 2.6, v: 215 },
  { t: T.s3GrabAt + 3.8, v: 320 },
  { t: T.s3DragEnd, v: 352 },
];

export const dragAngle = (t: number) => Math.round(track(DRAG_KEYFRAMES, t));
