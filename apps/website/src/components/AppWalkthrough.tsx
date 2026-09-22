"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/hooks/useInView";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import pageStyles from "@/app/page.module.css";
import styles from "./AppWalkthrough.module.css";

// Supademo-style product walkthrough. Product owner, verbatim, after the previous
// (recreated-visuals) version: "THE 'demo' LOOKS NOTHING LIKE OUR APP... I'D RATHER
// HAVE IT BE LIKE A VIDEO (SUPADEMO STYLE) OF THE APP IN USE." Every screenshot here is
// a REAL capture of the REAL app components (Sidebar, TitleBar, ChatPane, MessageBubble,
// MessageContent, ArtifactBlock, unmodified) rendered with real captured backend content
// — see apps/desktop/src/marketing-harness.tsx (a dev-only, unshipped Vite entry) for
// exactly how each screenshot was produced and marketing-harness.tsx's own header
// comment for what's genuinely live vs. reproduced. Scene 3's artifact is not a static
// picture of the real thing — it's the actual live artifact, embedded the same
// sandboxed way the real app renders it, still draggable here.
const SCENE_DURATIONS_MS = [6500, 6000]; // scenes 0 and 1 only — scene 2 is terminal
const FINAL_SCENE = 2;

interface SceneConfig {
  title: string;
  caption: string;
  /** Percentage-position callout — a silent pulsing ring pointing at the one real UI
   * element the caption is talking about, in place of an annotation label (product
   * owner: "LESS TEXT, LESS THINGS TO CLICK, MORE VISUALS"). Coordinates are eyeballed
   * against the real screenshot pixel content once, not computed. */
  callout: { left: string; top: string };
}

const SCENES: SceneConfig[] = [
  {
    title: "Newton catches the mistake",
    caption: "Wrong answer, real symbolic math, then a guiding question — not the fix.",
    callout: { left: "46%", top: "26%" },
  },
  {
    title: "Highlight to understand",
    caption: "Select any phrase in your notes for an explanation grounded in your own material.",
    callout: { left: "67%", top: "40%" },
  },
  {
    title: "Newton builds the visual",
    caption: "A real interactive artifact — drag the point below, it's genuinely live.",
    callout: { left: "66%", top: "50%" },
  },
];

function CalloutRing({ left, top }: { left: string; top: string }) {
  return (
    <span className={styles.callout} style={{ left, top }} aria-hidden="true">
      <span className={styles.calloutPulse} />
      <span className={styles.calloutDot} />
    </span>
  );
}

function SceneStudyMode() {
  return (
    <div className={styles.frameInner}>
      {/* eslint-disable-next-line @next/next/no-img-element -- real static screenshot asset, not an optimizable remote/content image */}
      <img
        src="/demo/screens/study-mode.png"
        alt="Newton's desktop app: a factoring question, real symbolic-math tool activity, and a guiding question pointing out the middle term is wrong."
        className={styles.frameImage}
      />
      <CalloutRing {...SCENES[0].callout} />
    </div>
  );
}

function SceneNotepad() {
  return (
    <div className={styles.frameInner}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/demo/screens/notepad.png"
        alt="Newton Notepad: a highlighted phrase in a lecture note with Explain, Define, and Summarize buttons above it."
        className={styles.frameImage}
      />
      <CalloutRing {...SCENES[1].callout} />
    </div>
  );
}

function SceneArtifact() {
  return (
    <div className={styles.frameInner}>
      <iframe
        src="/demo/unit-circle-artifact.html"
        sandbox="allow-scripts"
        title="Live artifact: the unit circle, built by Newton — drag the point"
        className={styles.frameIframe}
        loading="lazy"
      />
      <CalloutRing {...SCENES[2].callout} />
    </div>
  );
}

const SCENE_COMPONENTS = [SceneStudyMode, SceneNotepad, SceneArtifact];

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

  useEffect(() => {
    remainingRef.current = SCENE_DURATIONS_MS[active] ?? 0;
    setProgressPct(reducedMotion ? 100 : 0);
  }, [active, playToken, reducedMotion]);

  useEffect(() => {
    if (reducedMotion || !inView || paused) return;
    if (active >= SCENE_DURATIONS_MS.length) return; // scene 2 is terminal — no timer, ever
    const duration = SCENE_DURATIONS_MS[active];
    const id = setInterval(() => {
      remainingRef.current -= 100;
      setProgressPct(Math.min(100, Math.max(0, 100 - (remainingRef.current / duration) * 100)));
      if (remainingRef.current <= 0) {
        clearInterval(id);
        goNext();
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, reducedMotion, inView, playToken]);

  const Scene = SCENE_COMPONENTS[active];

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
        <div className={styles.rail} role="tablist" aria-label="Walkthrough steps">
          {SCENES.map((scene, i) => (
            <button
              key={scene.title}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Step ${i + 1}: ${scene.title}`}
              className={i === active ? styles.railItemActive : styles.railItem}
              onClick={() => goTo(i)}
            >
              <span className={styles.railIndex}>{i + 1}</span>
              <span className={styles.railText}>
                <span className={styles.railTitle}>{scene.title}</span>
                <span className={styles.railCaption}>{scene.caption}</span>
              </span>
              <span className={styles.railProgressTrack}>
                <span
                  className={styles.railProgressFill}
                  style={{
                    width:
                      i < active
                        ? "100%"
                        : i === active
                          ? `${active >= SCENE_DURATIONS_MS.length ? 100 : progressPct}%`
                          : "0%",
                  }}
                />
              </span>
            </button>
          ))}
        </div>

        <div className={styles.frameCol}>
          <div className={styles.deviceFrame} key={`${active}-${playToken}`}>
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
      </div>
    </section>
  );
}
