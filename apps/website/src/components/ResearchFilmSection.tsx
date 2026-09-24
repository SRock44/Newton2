"use client";

import FilmPlayer from "./FilmPlayer";
import pageStyles from "@/app/page.module.css";

// A SEPARATE film for higher-level work, next to the main product film (which stays the only
// film in the hero flow). Product owner, verbatim: "Great, now lets do a SEPARATE demo for
// higher level education. Writing an arxiv level paper with a bunch of random notes and a
// synopsis document, and outputting a quality latex paper ... We want to show that Newton can be
// used at ALL levels, not just the lower levels."
//
// The film (apps/promo-video's ResearchFilm) renders the real desktop-app components: a
// researcher uploads messy lab notes and a project synopsis, attaches both to a chat, and asks
// for an arXiv-style paper. Newton plans it, takes a round of changes, then writes and compiles
// the LaTeX. Once it's written, the student attaches the finished PDF right back into the same
// chat, opens it there (DocumentViewerPanel, split with the conversation, real pdf.js rendering
// -- not a navigation away), highlights a real sentence in it, and asks about it. Every word,
// number and page is real captured output from the deployed backend (see WEBSITE-ROADMAP.md,
// Phase 3.14).

export default function ResearchFilmSection() {
  return (
    <section
      id="demo-research"
      className={pageStyles.section}
      style={{ maxWidth: 1360 }}
      aria-labelledby="demo-research-heading"
    >
      <div className={pageStyles.sectionHead}>
        <p className={pageStyles.eyebrow}>For research, too</p>
        <h2 id="demo-research-heading" className={pageStyles.sectionTitle}>
          From messy notes to a real paper.
        </h2>
        <p className={pageStyles.sectionSubtitle}>
          Newton works at every level. Give it your lab notes and a synopsis, and it plans, writes
          and compiles an arXiv-style paper — then discusses the finished PDF with you, right in
          the same chat.
        </p>
      </div>

      <FilmPlayer
        src="/demo/newton-research.mp4"
        poster="/demo/newton-research-poster.jpg"
        ariaLabel="Screen film of a graduate student writing a paper with Newton: uploading scratch lab notes and a project synopsis, attaching both to one chat, reviewing and revising Newton's paper plan, approving it, then attaching the finished PDF back into the chat, opening it split with the conversation, highlighting a sentence in it and asking Newton about it."
      />
    </section>
  );
}
