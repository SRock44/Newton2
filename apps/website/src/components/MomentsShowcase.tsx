"use client";

import Reveal from "./Reveal";
import styles from "./MomentsShowcase.module.css";

// Replaces AppWalkthrough/ResearchFilmSection's two autoplaying videos with real, static
// screenshots — the exact same captured product UI (cropped straight from the already-
// rendered films in apps/promo-video/out/, picked by actually looking at the frames, not
// guessed) presented as images instead of video. Product owner, verbatim: "remove the
// video stuff, use images ... to demo the app."

interface Moment {
  src: string;
  alt: string;
  title: string;
  body: string;
}

const MOMENTS: Moment[] = [
  {
    src: "/moments/computed-math.jpg",
    alt: "Newton's chat showing two 'Solving with symbolic math — Verified' badges above a worked derivation of the product rule, with the student's lecture handout attached.",
    title: "Real computation, not a guess",
    body: "Checked with real symbolic math (SymPy), with the student's own handout attached — not an LLM predicting plausible-looking steps.",
  },
  {
    src: "/moments/pushback.jpg",
    alt: "Newton's chat telling the student 'Close — you got all the pieces in the right places, just check the sign' inside a 'Your turn' box asking them to try again.",
    title: "Pushes back until it clicks",
    body: "Focus Mode holds the answer back — the student tries again, Newton checks it, and explains exactly where the sign went.",
  },
  {
    src: "/moments/study-session.jpg",
    alt: "Newton's chat reply after uploading a midterm study packet: deadlines tracked, 18 flashcards, and a 15-question practice exam, each as its own clickable card.",
    title: "A full study session, from your own material",
    body: "Upload a packet and get deadlines, flashcards, and a practice exam back — each one a real, clickable result, not a wall of text.",
  },
  {
    src: "/moments/research-paper.jpg",
    alt: "A compiled arXiv-style PDF open split with the chat, a sentence highlighted with Explain/Define/Summarize/Ask Newton options, discussing the paper's own results.",
    title: "Research-grade output",
    body: "A real compiled LaTeX PDF, written from the student's own notes and synopsis — opened split with the chat to discuss, right where it was written.",
  },
];

export default function MomentsShowcase() {
  return (
    <section id="demo" className={styles.section} aria-labelledby="moments-heading">
      <Reveal className={styles.sectionHead}>
        <p className={styles.eyebrow}>The first Agentic Learning Environment</p>
        <h2 id="moments-heading" className={styles.sectionTitle}>
          This is the app, not a pitch.
        </h2>
        <p className={styles.sectionSubtitle}>
          Four real moments, captured straight from the real product — not recreated for
          a demo.
        </p>
      </Reveal>

      <div className={styles.grid}>
        {MOMENTS.map((m, i) => (
          <Reveal key={m.src} className={styles.card} delayMs={i * 80}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a handful of fixed, local, pre-sized JPEGs; next/image's optimization pipeline is unneeded overhead here. */}
            <img src={m.src} alt={m.alt} className={styles.cardImage} loading="lazy" />
            <div className={styles.cardBody}>
              <h3 className={styles.cardTitle}>{m.title}</h3>
              <p className={styles.cardText}>{m.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
