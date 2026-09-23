"use client";

import FilmPlayer from "./FilmPlayer";
import pageStyles from "@/app/page.module.css";

// The second film: a much more demanding student. Product owner, verbatim: "the user is a much
// more sophisticated student, and uploads his MECHANICAL engineering work to Newton DOCUMENTS,
// then adds the slides/pdf to the chat, and has an entire conversation about it. He builds an
// artifact, pushes back on Newton, and gains further understanding" — and "really show off how
// Newton is a real LEARNING tool, not a cheating tool or another ChatGPT/Claude."
//
// Like the first film it is a Remotion render of the REAL desktop components (apps/promo-video,
// src/eng). The student uploads a real lecture deck on the Documents page, attaches it from
// Documents in a new chat with Learn Mode on, builds an interactive artifact, disputes the 16x
// deflection ratio, and — when he asks for the homework answer — is walked to it a step at a
// time. Every word Newton says was captured from the real backend, unedited.

export default function EngineerWalkthrough() {
  return (
    <section
      id="demo-engineering"
      className={pageStyles.section}
      style={{ maxWidth: 1360, borderTop: "none", paddingTop: 24 }}
      aria-labelledby="demo-engineering-heading"
    >
      <div className={pageStyles.sectionHead}>
        <p className={pageStyles.eyebrow}>For the student who wants to actually get it</p>
        <h2 id="demo-engineering-heading" className={pageStyles.sectionTitle}>
          Push back. Newton holds its ground.
        </h2>
        <p className={pageStyles.sectionSubtitle}>
          A mechanical-engineering student uploads his lecture slides, builds an interactive model
          of beam deflection, disputes the math, and gets walked to the homework answer step by
          step — never just handed it.
        </p>
      </div>

      <FilmPlayer
        src="/demo/newton-engineering.mp4"
        poster="/demo/newton-engineering-poster.jpg"
        ariaLabel="Screen film of a mechanical-engineering student using Newton: uploading lecture slides on the Documents page, attaching them to a Learn Mode chat, building and exploring an interactive beam-deflection artifact, pushing back on Newton's answer, and being guided step by step through a homework problem."
      />
    </section>
  );
}
