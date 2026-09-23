"use client";

import FilmPlayer from "./FilmPlayer";
import pageStyles from "@/app/page.module.css";

// ONE continuous product film that shows everything, not a slideshow and not a pile of
// separate demos. Product owner, verbatim: "The end goal is to have ONE product video that
// showcases everything, instead of a bunch of separate ones." The film (apps/promo-video's
// ShowFilm, a Remotion project) renders the REAL, unmodified desktop-app components on one
// desktop: a student takes notes in the Notepad and highlights a term to Define and a formula to
// Explain — Newton's answers land as cards right in the note; uploads a lecture handout on the
// Documents page and attaches it to a Learn Mode chat straight from Documents; is walked
// through why integration by parts works — typing answers, getting pushed back on a sign error
// and asked to explain it in his own words; and finally uses Newton Research for real sources.
// Every word Newton says is real captured output (see WEBSITE-ROADMAP.md, Phase 3.13). The
// player itself (autoplay in view, reduced motion, click to pause) lives in FilmPlayer.tsx.

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
        src="/demo/newton-showcase.mp4"
        poster="/demo/newton-showcase-poster.jpg"
        ariaLabel="Screen film of a student using Newton: highlighting a term and a formula in the Notepad to define and explain them, uploading a lecture handout to Documents, attaching it to a Learn Mode chat, typing answers and getting pushed back on until integration by parts makes sense, and using Newton Research to find real sources."
      />
    </section>
  );
}
