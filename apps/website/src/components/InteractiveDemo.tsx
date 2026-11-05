"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import styles from "./InteractiveDemo.module.css";

// Round 3 of this component. Round 1 was the old hero-adjacent video (AppWalkthrough/
// FilmPlayer) — replaced because it was a recording of the desktop app's own chrome, not
// something web-native. Round 2 turned it into a single small "fake browser window" with
// three tiny text tabs a visitor had to click to discover ("Real computation"/"Pushes
// back"/"Remembers your semester") — direct feedback on THAT: "still not happy with the
// preview of the 3 things... terrible... be creative." The real problem wasn't the copy
// or the colors, it was the shape: a cramped tab bar hides two thirds of the demo behind
// a click nobody is prompted to make, and it was still styled as "one window" instead of
// reading as a real piece of this web page.
//
// This round follows the design kit's own "bento live widgets" recipe (composition.md):
// three real, separately-colored cards, laid out in a grid instead of a tab stack, each
// one ALREADY alive — a self-looping CSS/JS motion, not a static screenshot waiting to be
// clicked — so a visitor sees all three capabilities at once without ever touching
// anything. Still fully grounded in real product behavior (SymPy-checked computation,
// the Focus Mode pushback loop, FSRS-scheduled flashcards) and still genuinely
// interactive (the flashcard still flips on click), just no longer gated behind tabs.

export default function InteractiveDemo() {
  const reducedMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  const userFlippedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // A single, one-time auto-flip demonstrates the flashcard's own interaction model to a
  // visitor who never clicks anything — then gets out of the way. Cancelled the instant a
  // real person touches the card themselves, and skipped entirely under reduced-motion.
  useEffect(() => {
    if (reducedMotion) return;
    timersRef.current.push(
      setTimeout(() => {
        if (!userFlippedRef.current) setFlipped(true);
      }, 2600),
      setTimeout(() => {
        if (!userFlippedRef.current) setFlipped(false);
      }, 5600)
    );
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [reducedMotion]);

  function toggleFlip() {
    userFlippedRef.current = true;
    timersRef.current.forEach(clearTimeout);
    setFlipped((f) => !f);
  }

  return (
    <div className={styles.bentoWrap}>
      <p className={styles.liveLabel}>
        <span className={styles.liveDot} aria-hidden="true" />
        Live right now at newton.best/chat
      </p>

      <div className={styles.bentoGrid}>
        <article className={`${styles.bentoCard} ${styles.bentoCompute}`}>
          <div className={styles.bentoHead}>
            <span className={styles.bentoIcon} aria-hidden="true">
              ∑
            </span>
            <h3 className={styles.bentoTitle}>Real computation</h3>
          </div>
          <div className={styles.conversation}>
            <div className={styles.bubbleRow}>
              <span className={`${styles.avatar} ${styles.avatarUser}`} aria-hidden="true">
                U
              </span>
              <div className={styles.bubbleUser}>What&apos;s the derivative of x·eˣ?</div>
            </div>
            <div className={styles.bubbleRow}>
              <span className={`${styles.avatar} ${styles.avatarNewton}`} aria-hidden="true">
                N
              </span>
              <div className={styles.bubbleNewton}>
                <span className={styles.verifiedBadge}>
                  <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.verifiedIcon}>
                    <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.18" />
                    <path
                      d="M6 10.5l2.5 2.5L14 7"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Verified
                </span>
                <p className={styles.computeLine}>
                  Using the product rule: <code>d/dx[x·eˣ] = eˣ + x·eˣ</code>
                </p>
                <p className={styles.fine}>Checked with real symbolic computation (SymPy) — not predicted text.</p>
              </div>
            </div>
          </div>
        </article>

        <article className={`${styles.bentoCard} ${styles.bentoPushback}`}>
          <div className={styles.bentoHead}>
            <span className={styles.bentoIcon} aria-hidden="true">
              ◐
            </span>
            <h3 className={styles.bentoTitle}>Pushes back</h3>
          </div>
          <div className={styles.conversation}>
            <div className={styles.bubbleRow}>
              <span className={`${styles.avatar} ${styles.avatarUser}`} aria-hidden="true">
                U
              </span>
              <div className={styles.bubbleUser}>∫u dv = uv + ∫v du</div>
            </div>
            <div className={styles.bubbleRow}>
              <span className={`${styles.avatar} ${styles.avatarNewton}`} aria-hidden="true">
                N
              </span>
              <div className={styles.bubbleNewton}>
                <p>Close — you got all the pieces in the right places, just check the sign.</p>
              </div>
            </div>
            <div className={styles.yourTurn}>
              <span className={styles.yourTurnGlow} aria-hidden="true" />
              <p className={styles.yourTurnLabel}>Your turn</p>
              <p>Where would that sign come from if you moved the integral across the equals sign yourself?</p>
            </div>
          </div>
        </article>

        <article className={`${styles.bentoCard} ${styles.bentoRemembers}`}>
          <div className={styles.bentoHead}>
            <span className={styles.bentoIcon} aria-hidden="true">
              ◈
            </span>
            <h3 className={styles.bentoTitle}>Remembers your semester</h3>
          </div>
          <button
            type="button"
            className={`${styles.flashcard} ${flipped ? styles.flashcardFlipped : ""}`}
            onClick={toggleFlip}
            aria-label="Flip flashcard"
          >
            <span className={styles.flashcardInner}>
              <span className={styles.flashcardFace}>
                <span className={styles.flashcardLabel}>Due today</span>
                <span className={styles.flashcardFront}>What does LIATE stand for?</span>
                <span className={styles.flashcardHint}>Click to flip — scheduled by your real recall history.</span>
              </span>
              <span className={`${styles.flashcardFace} ${styles.flashcardBack}`}>
                <span className={styles.flashcardLabel}>Answer</span>
                <span className={styles.flashcardFront}>
                  Logarithmic, Inverse trig, Algebraic, Trig, Exponential
                </span>
                <span className={styles.flashcardHint}>FSRS schedules the next review from how well you knew this.</span>
              </span>
            </span>
          </button>
          <div className={styles.weakArea}>
            <span className={styles.weakDot} aria-hidden="true" />
            Weak area: trig substitution — 3 missed questions this week, queued next.
          </div>
        </article>
      </div>
    </div>
  );
}
