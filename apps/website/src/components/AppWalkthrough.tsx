"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/hooks/useInView";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import pageStyles from "@/app/page.module.css";
import styles from "./AppWalkthrough.module.css";

// Supademo-style product walkthrough — now an actual VIDEO of the real app being used,
// not a screenshot. Product owner, verbatim, after the screenshot-based version: "THIS
// 'LIVE DEMO' IS JUST A FUCKING PICTURE... IT SHOULD BE LIKE A REMOTION VIDEO OF THE
// PROMPT RUNNING, LIKE A PROMOTIONAL ADVERTISEMENT." Each clip is a REAL screen
// recording (Playwright's own video capture, not an edited/staged recording of
// something else) of the real, unmodified Sidebar/TitleBar/ChatPane/MessageBubble/
// NotepadWindow-classnames/ArtifactBlock components, driven by a SCRIPTED but entirely
// real sequence: a real prompt typed character by character, a real browser text
// Selection grown over real note content, real tool-activity chips and a real reply
// revealed progressively. See apps/desktop/src/marketing-harness.tsx (a dev-only,
// unshipped Vite entry, `?scene=study|notepad|artifact`) for exactly how each clip was
// produced, and its own header comment for the one deliberately-non-committal moment
// (a generic "Explaining…" shimmer instead of a fabricated AI answer).
//
// Scene 3 specifically: the video shows the prompt being typed and the artifact being
// built, then hands off to the ACTUAL live embedded artifact once the clip ends — a
// visitor can keep dragging it themselves. Never a picture of "live"; still genuinely
// live.
const FINAL_SCENE = 2;

interface SceneConfig {
  title: string;
  caption: string;
  video: string;
  poster: string;
  alt: string;
}

const SCENES: SceneConfig[] = [
  {
    title: "Newton catches the mistake",
    caption: "Wrong answer, real symbolic math, then a guiding question — not the fix.",
    video: "/demo/videos/study.mp4",
    poster: "/demo/videos/study-poster.jpg",
    alt: "Screen recording: a student types a factoring question into Newton, real symbolic-math tool activity runs, and Newton's reply points out the middle term is wrong with a guiding question instead of the fix.",
  },
  {
    title: "Highlight to understand",
    caption: "Select any phrase in your notes for an explanation grounded in your own material.",
    video: "/demo/videos/notepad.mp4",
    poster: "/demo/videos/notepad-poster.jpg",
    alt: "Screen recording: a student writes a lecture note in Newton Notepad, selects a phrase, and clicks Explain.",
  },
  {
    title: "Newton builds the visual",
    caption: "Newton builds a real interactive artifact — then you can drag it yourself.",
    video: "/demo/videos/artifact.mp4",
    poster: "/demo/videos/artifact-poster.jpg",
    alt: "Screen recording: a student asks Newton to build an interactive artifact teaching the unit circle, and it builds one live.",
  },
];

/** The "desktop" the app window sits on — a wallpaper-toned backdrop behind the video/
 * iframe, with a thin taskbar sliver at the bottom. Product owner: "MAKE IT LOOK LIKE A
 * DESKTOP, a user using the app." */
function Desktop({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.desktop}>
      <div className={styles.desktopSurface}>{children}</div>
      <div className={styles.taskbar} aria-hidden="true">
        <span className={styles.taskbarDot} />
        <span className={styles.taskbarDot} />
        <span className={styles.taskbarDot} />
        <span className={styles.taskbarSpacer} />
        <span className={styles.taskbarClock} />
      </div>
    </div>
  );
}

export default function AppWalkthrough() {
  const [active, setActive] = useState(0);
  const [playToken, setPlayToken] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [showLiveArtifact, setShowLiveArtifact] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
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

  // A fresh clip every time the active scene (or a manual replay) changes.
  useEffect(() => {
    setProgressPct(0);
    setShowLiveArtifact(false);
  }, [active, playToken]);

  // Autoplay only while actually scrolled into view — the same "don't burn a visitor's
  // battery/bandwidth on an offscreen clip" rule the old interval-based version
  // followed, now expressed as real play()/pause() calls on the real <video> instead of
  // gating a fake timer.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || reducedMotion) return;
    if (inView) v.play().catch(() => {});
    else v.pause();
  }, [inView, active, playToken, reducedMotion]);

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration === 0) return;
    setProgressPct((v.currentTime / v.duration) * 100);
  }

  function handleEnded() {
    setProgressPct(100);
    if (active === FINAL_SCENE) {
      setShowLiveArtifact(true);
      return;
    }
    goNext();
  }

  const scene = SCENES[active];
  const isLiveArtifactScene = active === FINAL_SCENE && showLiveArtifact;

  return (
    <section
      id="demo"
      className={pageStyles.section}
      style={{ maxWidth: 1360 }}
      aria-labelledby="demo-heading"
    >
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
        onMouseEnter={() => videoRef.current?.pause()}
        onMouseLeave={() => {
          if (!reducedMotion && inView) videoRef.current?.play().catch(() => {});
        }}
      >
        <div className={styles.rail} role="tablist" aria-label="Walkthrough steps">
          {SCENES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Step ${i + 1}: ${s.title}`}
              className={i === active ? styles.railItemActive : styles.railItem}
              onClick={() => goTo(i)}
            >
              <span className={styles.railIndex}>{i + 1}</span>
              <span className={styles.railText}>
                <span className={styles.railTitle}>{s.title}</span>
                <span className={styles.railCaption}>{s.caption}</span>
              </span>
              <span className={styles.railProgressTrack}>
                <span
                  className={styles.railProgressFill}
                  style={{
                    width: i < active ? "100%" : i === active ? `${progressPct}%` : "0%",
                  }}
                />
              </span>
            </button>
          ))}
        </div>

        <div className={styles.frameCol}>
          <div className={styles.deviceFrame}>
            <Desktop>
              {isLiveArtifactScene ? (
                <iframe
                  src="/demo/unit-circle-artifact.html"
                  sandbox="allow-scripts"
                  title="Live artifact: the unit circle, built by Newton — drag the point"
                  className={styles.windowIframe}
                  loading="lazy"
                />
              ) : reducedMotion ? (
                active === FINAL_SCENE ? (
                  <iframe
                    src="/demo/unit-circle-artifact.html"
                    sandbox="allow-scripts"
                    title="Live artifact: the unit circle, built by Newton — drag the point"
                    className={styles.windowIframe}
                    loading="lazy"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a static
                  // poster frame, not an optimizable remote/content image
                  <img src={scene.poster} alt={scene.alt} className={styles.windowImage} />
                )
              ) : (
                <video
                  key={`${active}-${playToken}`}
                  ref={videoRef}
                  src={scene.video}
                  poster={scene.poster}
                  aria-label={scene.alt}
                  className={styles.windowImage}
                  muted
                  playsInline
                  autoPlay
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={handleEnded}
                />
              )}
            </Desktop>
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
