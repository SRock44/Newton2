"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the user's `prefers-reduced-motion` OS/browser setting so scroll reveals, the
 * hero's float/typing effects, and the demo replay can all skip straight to their final
 * state instead of animating — same discipline globals.css's `scroll-behavior: auto`
 * override already applies to smooth-scrolling.
 *
 * Defaults to `false` (motion allowed) during SSR/first paint since `window` doesn't
 * exist yet; corrects itself in a layout-safe effect on mount before anything has had a
 * chance to actually animate.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);

    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}
