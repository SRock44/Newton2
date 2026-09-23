"use client";

import FilmPlayer from "./FilmPlayer";
import pageStyles from "@/app/page.module.css";

// One continuous product film, not a slideshow. Product owner, verbatim: "MAKE IT A
// REMOTION VIDEO (ONE VIDEO, NOT MULTIPLE SLIDES) OF A USER USING NEWTON IN ALL OF ITS
// CAPACITY." The film (apps/promo-video, a Remotion project) renders the REAL, unmodified
// desktop-app components on one desktop: a student asks Newton to check factoring work,
// types "Photosynthesis" into the Notepad and gets an instant definition, then asks for an
// interactive artifact, approves the plan, and drags the finished result. Every string is
// real captured Newton output (see WEBSITE-ROADMAP.md, Phase 3.11). The player itself
// (autoplay in view, reduced motion, click to pause) lives in FilmPlayer.tsx.

export default function AppWalkthrough() {
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

      <FilmPlayer
        src="/demo/newton-promo.mp4"
        poster="/demo/newton-promo-poster.jpg"
        ariaLabel="Screen film of a student using Newton: checking factoring work with real computation, defining a word from class notes in Notepad, and building and exploring an interactive unit-circle artifact."
      />
    </section>
  );
}
