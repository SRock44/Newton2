export const FPS = 30;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0..1 progress of `t` through [start, start+dur]. */
export const prog = (t: number, start: number, dur: number) => clamp01((t - start) / dur);

/** The first N characters of `text` after typing began at `start` at `cps` chars/sec. */
export function typed(text: string, t: number, start: number, cps: number): string {
  const n = Math.max(0, Math.min(text.length, Math.floor((t - start) * cps)));
  return text.slice(0, n);
}

/** Rect in `container`'s own layout units, robust to any CSS transforms above it. */
export function measure(el: Element, container: HTMLElement) {
  const c = container.getBoundingClientRect();
  const s = container.offsetWidth ? c.width / container.offsetWidth : 1;
  const r = el.getBoundingClientRect();
  return {
    left: (r.left - c.left) / s,
    top: (r.top - c.top) / s,
    width: r.width / s,
    height: r.height / s,
  };
}

export interface Keyframe<T> {
  t: number;
  v: T;
}

/** Eased interpolation between numeric keyframes. */
export function track(kfs: Keyframe<number>[], t: number): number {
  if (t <= kfs[0].t) return kfs[0].v;
  for (let i = 1; i < kfs.length; i++) {
    if (t <= kfs[i].t) {
      const a = kfs[i - 1];
      const b = kfs[i];
      return lerp(a.v, b.v, easeInOut((t - a.t) / (b.t - a.t)));
    }
  }
  return kfs[kfs.length - 1].v;
}
