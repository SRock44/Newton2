"use client";

import { useEffect, useRef, useState } from "react";

interface UseInViewOptions {
  /** Fraction of the element that must be visible before it's considered "in view". */
  threshold?: number;
  /** Shrinks/grows the viewport root used for the intersection check, same syntax as
   * IntersectionObserver's own `rootMargin`. */
  rootMargin?: string;
  /** Once true (the default), the observer disconnects after the first time the element
   * enters the viewport — a scroll reveal or an autoplay trigger should fire once, not
   * flicker every time the section scrolls in and out. */
  once?: boolean;
  /** What to report when IntersectionObserver itself isn't available. Scroll-reveal
   * content defaults this to `true` so it's never stuck invisible for lack of the API
   * (progressive enhancement — the reveal is a bonus, not a gate). The demo section's
   * autoplay-on-scroll passes `false`: without a real observer there's no real "scrolled
   * into view" signal to act on, so it should stay idle (still playable by hand via its
   * scenario tabs) rather than assume it's in view and start firing real timers. */
  fallbackInView?: boolean;
}

/**
 * IntersectionObserver-backed "has this element scrolled into view" hook, shared by the
 * section-level scroll reveals (page.module.css's `.reveal`/`.revealVisible`) and the
 * demo section's autoplay-on-scroll-into-view trigger.
 *
 * Falls back to reporting "in view" immediately when IntersectionObserver isn't
 * available (older browsers, some test environments) so content is never permanently
 * stuck invisible for lack of the API.
 */
export function useInView<T extends HTMLElement>({
  threshold = 0.2,
  rootMargin = "0px 0px -10% 0px",
  once = true,
  fallbackInView = true,
}: UseInViewOptions = {}) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(fallbackInView);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold, rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, rootMargin, once, fallbackInView]);

  return { ref, inView };
}
