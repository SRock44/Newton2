"use client";

import { useEffect, useRef, useState } from "react";
import GradedPaper from "./GradedPaper";
import { useInView } from "@/hooks/useInView";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import pageStyles from "@/app/page.module.css";
import styles from "./AppWalkthrough.module.css";

// Replaces the old chat-transcript hero demo (DemoTranscript.tsx, deleted this pass)
// AND folds in the separate "Verified, not vibes"/GradedPaper section and the Notepad
// section — one Supademo/Arcade-style stepped walkthrough instead of three separate
// page sections. Product owner, verbatim: "make the LIVE DEMO ACTUALLY LOOK LIKE OUR
// APP... I'D RATHER HAVE IT BE LIKE A VIDEO (SUPADEMO STYLE)... show off THE ACTUAL
// USEFUL FEATURES." Three real scenes, auto-advancing like a video with a visible
// progress indicator, pausing on hover, with manual prev/next and clickable step
// segments for a visitor who wants to jump around:
//   1. Study Mode  — GradedPaper.tsx, reused as-is, plus the real guiding follow-up
//      question pulled verbatim from src/data's captured "math-catches-mistake"
//      transcript (see that scenario's `chunk` frames — this file hardcodes the exact
//      text, the same convention GradedPaper.tsx itself already uses for the same
//      scenario, rather than re-adding a JSON import for one quote).
//   2. Newton Notepad — the same real "Lecture 14 — Electromagnetism" highlight-to-
//      explain content the old Notepad section used, unchanged.
//   3. Artifact generation — a real prompt, the real "Building your interactive demo"
//      progress label create_artifact.py's own on_progress callback uses for
//      kind="interactive" (see _ARTIFACT_BUILDING_LABELS in that file), then the real
//      artifact itself: a live, embedded, genuinely interactive HTML page built by the
//      real create_artifact tool (services/api/app/tools/create_artifact.py), served
//      from public/demo/unit-circle-artifact.html and rendered in a sandboxed iframe —
//      `sandbox="allow-scripts"` only, no `allow-same-origin`, matching that tool's own
//      documented rendering posture for untrusted artifact content (no storage access,
//      no network). This scene never auto-advances away — it's the resting state, so a
//      visitor can keep dragging the real artifact for as long as they want.
const SCENE_DURATIONS_MS = [7000, 5500]; // scenes 0 and 1 only — scene 2 is terminal
const FINAL_SCENE = 2;

const SCENE_LABELS = ["Study Mode", "Newton Notepad", "Artifact generation"];

/** A small hand-drawn-style checkmark, standing in for "this step is done" rather than
 * a spinner — the artifact below is already live, not still loading. */
function DoneCheck() {
  return (
    <svg className={styles.buildingCheck} viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <path
        d="M1.5 7 L6 12 L14.5 1.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SceneStudyMode() {
  return (
    <div className={styles.sceneGrid}>
      <div className={styles.sceneVisual}>
        <GradedPaper />
      </div>
      <div className={styles.sceneCopy}>
        <p className={styles.sceneKicker}>Focus Mode</p>
        <blockquote className={styles.quoteBubble}>
          &ldquo;Try this: can you find a different pair of numbers that multiply to 6
          but add up to 5 instead of 7?&rdquo;
        </blockquote>
        <p className={styles.sceneCaption}>
          Newton points to the mistake, then asks a guiding question instead of the
          answer.
        </p>
      </div>
    </div>
  );
}

function SceneNotepad() {
  return (
    <div className={styles.sceneGrid}>
      <div className={styles.sceneVisual}>
        <div className={styles.notepadCard} aria-hidden="true">
          <p className={styles.notepadCardTitle}>Lecture 14 — Electromagnetism</p>
          <p className={styles.notepadCardBody}>
            Hysteresis loops show how magnetization lags the applied field.{" "}
            <span className={styles.notepadHighlight}>
              the coercive field is path-dependent
            </span>{" "}
            &mdash; depends on the material&apos;s prior magnetic history, not just its
            current state.
          </p>
          <div className={styles.notepadPopover}>
            <p className={styles.notepadPopoverLabel}>Explain this</p>
            <p className={styles.notepadPopoverBody}>
              Path-dependent means the field needed to bring magnetization back to zero
              depends on how the material got there, not only where &ldquo;there&rdquo;
              is &mdash; that&apos;s exactly what a hysteresis loop is plotting.
            </p>
          </div>
        </div>
      </div>
      <div className={styles.sceneCopy}>
        <p className={styles.sceneKicker}>Newton Notepad</p>
        <p className={styles.sceneCaption}>
          Highlight anything in your notes — the explanation appears inline, grounded in
          your own material.
        </p>
      </div>
    </div>
  );
}

function SceneArtifact() {
  return (
    <div className={styles.sceneArtifact}>
      <p className={styles.sceneKicker}>Artifact generation</p>
      <div className={styles.artifactIntro}>
        <p className={styles.promptBubble}>
          &ldquo;Build me an interactive artifact that teaches the unit circle&rdquo;
        </p>
        <span className={styles.buildingChip}>
          <DoneCheck />
          Building your interactive demo
        </span>
      </div>
      <div className={styles.artifactFrameWrap}>
        <iframe
          src="/demo/unit-circle-artifact.html"
          sandbox="allow-scripts"
          title="Live artifact: the unit circle, built by Newton"
          className={styles.artifactFrame}
          loading="lazy"
        />
      </div>
      <p className={styles.sceneCaption}>
        Newton built this — drag the point, the values update live.
      </p>
    </div>
  );
}

const SCENES = [SceneStudyMode, SceneNotepad, SceneArtifact];

export default function AppWalkthrough() {
  const [active, setActive] = useState(0);
  const [playToken, setPlayToken] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const remainingRef = useRef(SCENE_DURATIONS_MS[0]);
  const reducedMotion = useReducedMotion();
  const { ref: sectionRef, inView } = useInView<HTMLDivElement>({
    threshold: 0.3,
    fallbackInView: false,
  });

  function goTo(index: number) {
    setActive(index);
    setPlayToken((t) => t + 1);
  }
  function goNext() {
    setActive((a) => Math.min(a + 1, FINAL_SCENE));
    setPlayToken((t) => t + 1);
  }
  function goPrev() {
    setActive((a) => Math.max(a - 1, 0));
    setPlayToken((t) => t + 1);
  }

  // Resets the countdown whenever the active scene changes (including a manual replay
  // of the same scene via playToken). Declared before the tick effect below so — within
  // the same commit — its setup always runs first and leaves a fresh value for the tick
  // effect's setup to read. Reduced motion skips the count (there's nothing to animate
  // toward; the scene just sits there, fully "filled", until a manual nav).
  useEffect(() => {
    remainingRef.current = SCENE_DURATIONS_MS[active] ?? 0;
    setProgressPct(reducedMotion ? 100 : 0);
  }, [active, playToken, reducedMotion]);

  // The real auto-advance engine: a 100ms tick that counts the active scene's real
  // remaining time down and calls goNext() at zero. A recurring tick (rather than one
  // setTimeout sized to the full duration) is what makes pause-on-hover exact: the
  // interval simply doesn't run while paused/out-of-view/reduced-motion, so
  // remainingRef keeps whatever value it had the moment it stopped, and resumes from
  // there — a real pause, not a restart.
  useEffect(() => {
    if (reducedMotion || !inView || paused) return;
    if (active >= SCENE_DURATIONS_MS.length) return; // scene 2 is terminal — no timer, ever
    const duration = SCENE_DURATIONS_MS[active];
    const id = setInterval(() => {
      remainingRef.current -= 100;
      setProgressPct(Math.min(100, Math.max(0, 100 - (remainingRef.current / duration) * 100)));
      if (remainingRef.current <= 0) {
        // Self-clearing: without this, a burst of fake-timer ticks (or just a slow
        // render) can fire this same interval several more times before React gets a
        // chance to run this effect's cleanup in response to `active` changing, racing
        // several real goNext() calls through in one go.
        clearInterval(id);
        goNext();
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, reducedMotion, inView, playToken]);

  const Scene = SCENES[active];

  return (
    <section id="demo" className={pageStyles.section} aria-labelledby="demo-heading">
      <div className={pageStyles.sectionHead}>
        <p className={pageStyles.eyebrow}>The first Agentic Learning Environment</p>
        <h2 id="demo-heading" className={pageStyles.sectionTitle}>
          This is the app.
        </h2>
        <p className={pageStyles.sectionSubtitle}>Built to teach you, not do it for you.</p>
      </div>

      <div
        ref={sectionRef}
        className={styles.stage}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className={styles.progressRow} role="tablist" aria-label="Walkthrough steps">
          {SCENE_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Step ${i + 1}: ${label}`}
              className={styles.progressSegment}
              onClick={() => goTo(i)}
            >
              <span
                className={styles.progressFill}
                style={{
                  width:
                    i < active
                      ? "100%"
                      : i === active
                        ? `${active >= SCENE_DURATIONS_MS.length ? 100 : progressPct}%`
                        : "0%",
                }}
              />
            </button>
          ))}
        </div>

        <div className={styles.scenePanel} key={`${active}-${playToken}`}>
          <Scene />
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.navButton}
            onClick={goPrev}
            disabled={active === 0}
            aria-label="Previous step"
          >
            ‹
          </button>
          <button
            type="button"
            className={styles.navButton}
            onClick={goNext}
            disabled={active === FINAL_SCENE}
            aria-label="Next step"
          >
            ›
          </button>
        </div>
      </div>
    </section>
  );
}
