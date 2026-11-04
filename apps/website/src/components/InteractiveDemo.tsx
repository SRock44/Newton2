"use client";

import { useState } from "react";
import styles from "./InteractiveDemo.module.css";

// Replaces the old hero-adjacent video (AppWalkthrough/FilmPlayer) with something built
// for the web, not filmed from the desktop app: a small, genuinely interactive component
// a visitor clicks through themselves, in this site's own design language — not a
// recording of the Tauri window's chrome. Every line of copy below is still grounded in
// real product behavior (the same computed-math/Verified-badge/pushback/FSRS mechanisms
// apps/website/src/app/about/page.tsx already documents in prose), just re-presented as a
// real, interactive web element instead of a paragraph or a video clip.
//
// Product owner, verbatim: "use images or interactive user experiences to demo the app
// ... make the app look like a WEB APP, not just a MIRROR OF THE DESKTOP APP."

interface Moment {
  id: string;
  tab: string;
  kicker: string;
}

const MOMENTS: Moment[] = [
  { id: "compute", tab: "Real computation", kicker: "Not a guess — real symbolic math" },
  { id: "pushback", tab: "Pushes back", kicker: "Focus Mode holds the answer back" },
  { id: "remembers", tab: "Remembers your semester", kicker: "FSRS-scheduled review" },
];

export default function InteractiveDemo() {
  const [active, setActive] = useState<string>(MOMENTS[0]!.id);

  return (
    <div className={styles.demo}>
      <div className={styles.tabs} role="tablist" aria-label="Newton capability demos">
        {MOMENTS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active === m.id}
            className={`${styles.tab} ${active === m.id ? styles.tabActive : ""}`}
            onClick={() => setActive(m.id)}
          >
            {m.tab}
          </button>
        ))}
      </div>

      <div className={styles.panel}>
        {active === "compute" && (
          <div className={styles.conversation} role="tabpanel">
            <p className={styles.kicker}>Not a guess — real symbolic math</p>
            <div className={styles.bubbleUser}>What&apos;s the derivative of x·eˣ?</div>
            <div className={styles.bubbleNewton}>
              <span className={styles.verifiedBadge}>
                <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.verifiedIcon}>
                  <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15" />
                  <path d="M6 10.5l2.5 2.5L14 7" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Verified
              </span>
              <p>
                Using the product rule: <code>d/dx[x·eˣ] = eˣ + x·eˣ</code>
              </p>
              <p className={styles.fine}>Checked with real symbolic computation (SymPy) — not predicted text.</p>
            </div>
          </div>
        )}

        {active === "pushback" && (
          <div className={styles.conversation} role="tabpanel">
            <p className={styles.kicker}>Focus Mode holds the answer back</p>
            <div className={styles.bubbleUser}>∫u dv = uv + ∫v du</div>
            <div className={styles.bubbleNewton}>
              <p>Close — you got all the pieces in the right places, just check the sign.</p>
            </div>
            <div className={styles.yourTurn}>
              <p className={styles.yourTurnLabel}>Your turn</p>
              <p>Where would that sign come from if you moved the integral across the equals sign yourself?</p>
            </div>
          </div>
        )}

        {active === "remembers" && (
          <div className={styles.conversation} role="tabpanel">
            <p className={styles.kicker}>FSRS-scheduled review</p>
            <div className={styles.flashcard}>
              <p className={styles.flashcardLabel}>Due today</p>
              <p className={styles.flashcardFront}>What does LIATE stand for?</p>
              <p className={styles.flashcardHint}>Tap to reveal — scheduled by your real recall history, not a fixed interval.</p>
            </div>
            <div className={styles.weakArea}>
              <span className={styles.weakDot} aria-hidden="true" />
              Weak area: trig substitution — 3 missed questions this week, queued next.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
