import type { Metadata } from "next";
import { ContentPage, ContentHero } from "@/components/ContentPage";
import styles from "./changelog.module.css";

// A curated, visitor-friendly translation of ROADMAP.md's real phase history — newest
// first. Every entry here corresponds to something actually shipped and verified in
// ROADMAP.md (cross-referenced while writing this), described in plain, student-facing
// language rather than internal phase numbers or file paths. No invented version
// numbers or release dates: ROADMAP.md tracks real work by evidentiary phase, not a
// public release calendar, so this is presented as an ordered feature log rather than
// dated releases.
const CHANGELOG_ENTRIES: string[] = [
  "Added real numeric methods and inferential statistics — ill-conditioned linear systems, root-finding, ODE integration, plus real t-tests, correlation, regression, ANOVA, and chi-square with real p-values.",
  "Generate a study plan, flashcards, or a practice exam from just a topic now — no document required. Great for test prep (SAT, GRE, MCAT) or starting a subject from zero.",
  "Added Deep Research: a standalone tool that synthesizes a cited report from several real web sources for an open question, separate from full paper writing.",
  "The green \"Verified\" badge is now real and server-checked — computed independently of the model's own wording, so it only appears on genuinely computed results.",
  "Focus Mode is now enforced by the server, not just requested of the model — a direct-answer dump gets caught and regenerated as real coaching before you ever see it.",
  "Reviewing a flagged weak area now opens exactly the right flashcards or missed exam questions, instead of a generic, unfiltered review panel.",
  "Research papers now get their citations checked against the real fetched text of each source — flagged honestly as grounded, ungrounded, or never actually fetched.",
  "Added real linear algebra (determinants, inverses, eigenvalues, null spaces) and a proof-checking tool that verifies every real algebraic sub-step and critiques logical structure.",
  "Added cross-document synthesis (ask a question that spans several of your readings) and in-document highlighting: select a passage and get an explanation attached right there.",
  "Added Conversation Practice: real turn-based spoken roleplay in your target language, with real multi-language text-to-speech and gentle in-context corrections.",
  "Added real code-correctness checking — runs your own code against real tests in a sandbox and reports exactly what happened. It never writes or fixes your code for you.",
  "Added MLA and Chicago paper styles, alongside the existing IEEE and APA7 — real compiled LaTeX documents, not just formatted citations.",
  "Added real chemistry computation: balancing equations with real linear algebra, stoichiometry with real atomic weights, gas-law and pH problems solved exactly.",
  "Added production-mode flashcards — shown the definition, type the term yourself, graded with a diacritic-aware comparison, instead of just recognizing an answer.",
  "Added AI-generated interactive artifacts: diagrams, charts, slideshows, and quiz games built to your actual material.",
  "Added document and Anki deck export, plus a personal calendar with an auto-updating ICS feed you can subscribe to from any calendar app.",
  "Added voice: real speech-to-text dictation and text-to-speech playback for chat replies.",
  "Added a home dashboard — recent documents, upcoming reviews, and your real progress at a glance, replacing an empty chat as the landing view.",
  "Added \"Learn Mode\": step-by-step math you have to attempt yourself before Newton reveals the next step, plus comprehension checkpoints during explanations.",
  "Added a baseline safety net that recognizes clear, direct statements of self-harm intent and responds with real crisis resources instead of continuing the tutoring conversation.",
  "Added self-service Focus Mode — a student-controlled toggle for stricter, more Socratic coaching on math and writing.",
  "Added full research paper writing: a plan-then-approve workflow that compiles a real, cited IEEE or APA7 paper to PDF.",
  "Added FSRS-scheduled spaced-repetition flashcards and adaptive practice exams generated from your own documents.",
  "Added the Newton Notepad: take live lecture notes, highlight a confusing passage, and get an explanation grounded in your own notes and documents.",
  "Added real symbolic math — exact solving, differentiating, integrating, simplifying, and factoring, with the derivation shown step by step.",
  "Newton's tutor loop shipped: real tool-calling, a persistent document library, and memory that carries across sessions instead of resetting every chat.",
];

export const metadata: Metadata = {
  title: "Changelog — Newton",
  description: "What's actually shipped, newest first — translated from Newton's real build history into plain language.",
};

export default function ChangelogPage() {
  return (
    <ContentPage>
      <ContentHero
        eyebrow="What's shipped"
        title="Changelog"
        subtitle="Newest first. Every entry here is something real, already built and verified — not a preview. Looking for what's next instead? See the roadmap."
      />

      <section className={styles.section} aria-label="Changelog">
        <ol className={styles.timeline}>
          {CHANGELOG_ENTRIES.map((entry, i) => (
            <li key={i} className={styles.entry}>
              <span className={styles.marker} aria-hidden="true" />
              <p className={styles.entryText}>{entry}</p>
            </li>
          ))}
        </ol>
      </section>
    </ContentPage>
  );
}
