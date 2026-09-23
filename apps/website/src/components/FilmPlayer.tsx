"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/hooks/useInView";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import styles from "./AppWalkthrough.module.css";

// One continuous product film in a rounded player. Playback: muted autoplay only while
// scrolled into view, looping; click to pause/resume. prefers-reduced-motion never autoplays —
// a poster and an explicit Play button instead. Shared by every film on the page.

export default function FilmPlayer({
  src,
  poster,
  ariaLabel,
}: {
  src: string;
  poster: string;
  ariaLabel: string;
}) {
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
    <div ref={frameRef} className={styles.frame}>
      <video
        ref={videoRef}
        className={styles.video}
        src={src}
        poster={poster}
        aria-label={ariaLabel}
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
  );
}
