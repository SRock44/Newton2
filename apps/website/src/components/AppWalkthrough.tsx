"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/hooks/useInView";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import pageStyles from "@/app/page.module.css";
import styles from "./AppWalkthrough.module.css";

// One continuous product film, not a slideshow. Product owner, verbatim: "MAKE IT A
// REMOTION VIDEO (ONE VIDEO, NOT MULTIPLE SLIDES) OF A USER USING NEWTON IN ALL OF ITS
// CAPACITY." The film (apps/promo-video, a Remotion project) renders the REAL, unmodified
// desktop-app components on one desktop: a student asks Newton to check factoring work,
// types "Photosynthesis" into the Notepad and gets an instant definition, then asks for an
// interactive artifact, approves the plan, and drags the finished result. Every string is
// real captured Newton output (see WEBSITE-ROADMAP.md, Phase 3.11).
//
// Playback: muted autoplay only while scrolled into view, looping; click to pause/resume.
// prefers-reduced-motion never autoplays — a poster and an explicit Play button instead.

export default function AppWalkthrough() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const { ref: frameRef, inView } = useInView<HTMLDivElement>({
    threshold: 0.35,
    fallbackInView: false,
  });

  // Autoplay while on screen; pause off screen. A manual pause is respected until the
  // visitor scrolls away and back.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || reducedMotion) return;
    if (inView) v.play().catch(() => {});
    else v.pause();
  }, [inView, reducedMotion]);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

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

      <div ref={frameRef} className={styles.frame}>
        <video
          ref={videoRef}
          className={styles.video}
          src="/demo/newton-promo.mp4"
          poster="/demo/newton-promo-poster.jpg"
          aria-label="Screen film of a student using Newton: checking factoring work with real computation, defining a word from class notes in Notepad, and building and exploring an interactive unit-circle artifact."
          muted
          loop
          playsInline
          preload="metadata"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && v.duration > 0) setProgressPct((v.currentTime / v.duration) * 100);
          }}
        />
        {!playing && (
          <button type="button" className={styles.playButton} onClick={toggle} aria-label="Play the film">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
          </button>
        )}
        <div className={styles.progressTrack} aria-hidden="true">
          <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
        </div>
      </div>
    </section>
  );
}
