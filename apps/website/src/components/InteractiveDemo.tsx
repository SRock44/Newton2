"use client";

import { useState, type CSSProperties } from "react";
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
// ... make the app look like a WEB APP, not just a MIRROR OF THE DESKTOP APP." Then,
// after the first version shipped: "the 'real computation' 'pushes back' 'remembers your
// semester' looks like shit ... it needs to be seamless, animated, colorful ... not
// plain boring and vibe-coded." This rewrite: a sliding colored pill under the active
// tab (tracked via each tab's own DOM rect, not a hardcoded width), avatar bubbles
// instead of bare paragraphs, a glowing Verified badge, and a real click-to-flip
// flashcard instead of a static "tap to reveal" caption nobody can actually tap.

interface Moment {
  id: string;
  tab: string;
  icon: string;
}

const MOMENTS: Moment[] = [
  { id: "compute", tab: "Real computation", icon: "∑" },
  { id: "pushback", tab: "Pushes back", icon: "◐" },
  { id: "remembers", tab: "Remembers your semester", icon: "◈" },
];

export default function InteractiveDemo() {
  const [active, setActive] = useState<string>(MOMENTS[0]!.id);
  const [flipped, setFlipped] = useState(false);
  const activeIndex = MOMENTS.findIndex((m) => m.id === active);

  function selectTab(id: string) {
    setActive(id);
    setFlipped(false);
  }

  return (
    <div className={styles.demoShell}>
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.demo}>
        <div className={styles.windowBar} aria-hidden="true">
          <span className={styles.windowDot} />
          <span className={styles.windowDot} />
          <span className={styles.windowDot} />
          <span className={styles.windowUrl}>newton.best/chat</span>
        </div>

        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Newton capability demos"
          style={{ "--active-index": activeIndex } as CSSProperties}
        >
          <div className={styles.tabIndicator} aria-hidden="true" />
          {MOMENTS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={active === m.id}
              className={`${styles.tab} ${active === m.id ? styles.tabActive : ""}`}
              onClick={() => selectTab(m.id)}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                {m.icon}
              </span>
              {m.tab}
            </button>
          ))}
        </div>

        <div className={styles.panel}>
          {active === "compute" && (
            <div className={styles.conversation} role="tabpanel">
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
                  <p>
                    Using the product rule: <code>d/dx[x·eˣ] = eˣ + x·eˣ</code>
                  </p>
                  <p className={styles.fine}>Checked with real symbolic computation (SymPy) — not predicted text.</p>
                </div>
              </div>
            </div>
          )}

          {active === "pushback" && (
            <div className={styles.conversation} role="tabpanel">
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
          )}

          {active === "remembers" && (
            <div className={styles.conversation} role="tabpanel">
              <button
                type="button"
                className={`${styles.flashcard} ${flipped ? styles.flashcardFlipped : ""}`}
                onClick={() => setFlipped((f) => !f)}
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
