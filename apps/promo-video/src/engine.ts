import { clamp01, easeInOut, lerp, measure, track, type Keyframe } from "./anim";

// Shared by every film in this project: a deterministic clock, the synthetic cursor's path
// resolution, and the camera. Everything here is a pure function of time `t` and the
// current DOM, because Remotion renders each frame on its own.

export type Pt = { x: number; y: number };
export type Target = string | Pt;
export interface CursorKey {
  t: number;
  at: Target;
  /** used when the target element isn't in the DOM (e.g. first frame of a fresh tab) */
  fb: Pt;
}
/** Resolves a target that isn't a plain element. `time` is the keyframe's own time, for targets
 * that move (a slider thumb whose value changes over the film). Return undefined to fall
 * through to the built-in handling. */
export type CustomResolver = (root: HTMLElement, name: string, time?: number) => Pt | null | undefined;
export interface Click {
  t: number;
  target: string;
}

/** Freezes "now" (the sidebar shows a live clock/date) so every frame renders identically. */
export function installFrozenTime(iso: string) {
  const RealDate = Date;
  const FIXED_NOW = new RealDate(iso).getTime();
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(FIXED_NOW);
      else super(...(args as [string]));
    }
    static now() {
      return FIXED_NOW;
    }
  }
  globalThis.Date = FixedDate as unknown as DateConstructor;
}

/** An element the cursor can aim at: `[data-promo="name"]`, or a few well-known buttons. */
export function findTarget(root: HTMLElement, name: string): Element | null {
  const byAttr = root.querySelector(`[data-promo="${name}"]`);
  if (byAttr) return byAttr;
  const byText = (selector: string, text: string) =>
    Array.from(root.querySelectorAll(selector)).find((b) => b.textContent?.includes(text)) ?? null;
  if (name === "newchat") return byText(".sidebar button", "New chat");
  if (name === "nav-documents") return byText(".sidebar button", "Documents");
  if (name === "buildit") return byText(".artifact-plan-card__actions button", "Build it");
  if (name === "expand") return root.querySelector(".artifact-block__actions button");
  return null;
}

/**
 * A point in the camera root's own layout units. `custom` lets a film resolve targets that
 * aren't plain elements (e.g. a point inside the artifact iframe); return undefined to fall
 * through to the built-in handling.
 */
export function resolveTarget(
  root: HTMLElement,
  at: Target,
  custom?: CustomResolver,
  time?: number,
): Pt | null {
  if (typeof at !== "string") return at;
  const c = custom?.(root, at, time);
  if (c !== undefined) return c;
  const el = findTarget(root, at);
  if (!el) return null;
  const m = measure(el, root);
  if (at === "composer") return { x: m.left + m.width * 0.3, y: m.top + m.height * 0.5 };
  if (at === "nb-body") return { x: m.left + 90, y: m.top + 22 };
  return { x: m.left + m.width / 2, y: m.top + m.height / 2 };
}

export function cursorAt(
  root: HTMLElement,
  t: number,
  script: CursorKey[],
  custom?: CustomResolver,
): Pt {
  const r = (i: number) => resolveTarget(root, script[i].at, custom, script[i].t) ?? script[i].fb;
  if (t <= script[0].t) return r(0);
  for (let i = 1; i < script.length; i++) {
    if (t <= script[i].t) {
      const a = r(i - 1);
      const b = r(i);
      const p = easeInOut(clamp01((t - script[i - 1].t) / (script[i].t - script[i - 1].t)));
      return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
    }
  }
  return r(script.length - 1);
}

/** Zoom toward (fx, fy) by z, never exposing the canvas edge. */
export function cameraTransform(t: number, Z: Keyframe<number>[], FX: Keyframe<number>[], FY: Keyframe<number>[]) {
  const z = track(Z, t);
  const tx = Math.min(0, Math.max(1920 * (1 - z), track(FX, t) * (1 - z)));
  const ty = Math.min(0, Math.max(1080 * (1 - z), track(FY, t) * (1 - z)));
  return `translate(${tx}px, ${ty}px) scale(${z})`;
}

export const WALLPAPER =
  "radial-gradient(900px 600px at 15% 10%, rgba(120,150,235,0.20), transparent 60%), radial-gradient(800px 600px at 90% 100%, rgba(200,160,70,0.12), transparent 60%), linear-gradient(150deg, #2a3752 0%, #1b2640 48%, #101828 100%)";
