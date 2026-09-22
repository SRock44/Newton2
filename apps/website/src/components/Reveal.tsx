"use client";

import type { ReactNode } from "react";
import { useInView } from "@/hooks/useInView";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import styles from "./Reveal.module.css";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Staggers this element's reveal behind others in the same group (e.g. cards in a
   * grid) so they animate in as a sequence rather than all at once. Milliseconds. */
  delayMs?: number;
}

/**
 * Scroll-triggered reveal: fades/slides its children in once they cross into the
 * viewport (see useInView), and does nothing at all — renders children immediately,
 * fully visible, no transition — when the user has `prefers-reduced-motion: reduce` set
 * (see useReducedMotion). A plain `<div>` wrapper, so it's safe to drop around any block
 * of content without changing its semantics.
 */
export default function Reveal({ children, className = "", delayMs = 0 }: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const reducedMotion = useReducedMotion();

  const visible = reducedMotion || inView;

  return (
    <div
      ref={ref}
      className={`${styles.reveal} ${visible ? styles.revealVisible : ""} ${className}`.trim()}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}
