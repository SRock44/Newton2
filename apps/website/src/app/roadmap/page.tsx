import type { Metadata } from "next";
import { ContentPage, ContentHero } from "@/components/ContentPage";
import styles from "./roadmap.module.css";

// A short, honest "what's next" — grounded in ROADMAP.md's own real deferred/planned
// items, never presented as if already live. This is a visitor-friendly teaser, not a
// copy of the internal ROADMAP.md (no phase numbers, no file paths, no internal
// engineering detail). Every item here is something ROADMAP.md itself explicitly marks
// unbuilt/deferred/planned/greenlit-but-not-yet-built as of this writing — nothing here
// is invented.
const PLANNED_ITEMS: { title: string; body: string }[] = [
  {
    title: "A full web-based chat client",
    body:
      "A browser version of Newton for signed-in users, so you're not limited to the native desktop app — genuinely useful on a school-managed Chromebook, which can't run the desktop app at all. Not scheduled yet.",
  },
  {
    title: "A real, live \"Try it live\" demo",
    body:
      "The interactive demo on the homepage today replays real captured transcripts client-side — no live backend call happens. A real guest-session version (short-lived, rate-limited, no sign-in required) is planned but not started.",
  },
  {
    title: "Review reminders as real OS notifications",
    body:
      "Newton already knows exactly which flashcards are due, and the desktop app already has OS notification support wired up end to end. The one missing piece — a scheduled job that actually fires a due-review reminder — is a planned, low-effort next step, not built yet.",
  },
  {
    title: "A real academic-search integration",
    body:
      "Pulling real results directly from arXiv, Semantic Scholar, CrossRef, and PubMed for research and paper-writing, rather than general web search alone. Identified as a low-friction, high-value addition; not built yet.",
  },
  {
    title: "An end-of-session report for Conversation Practice",
    body:
      "A real summary of a spoken language-practice session — what came up, what corrections were made — instead of the practice conversation simply ending. Planned, not built yet.",
  },
  {
    title: "A weekly progress digest",
    body:
      "A real, periodic summary of your studying — deliberately held back until there's a real delivery channel for it (an OS notification is too thin for a digest; email would be new infrastructure this app doesn't have yet).",
  },
  {
    title: "Collaborative study rooms",
    body:
      "Studying alongside classmates inside Newton, rather than alone. An early, deliberately deferred idea — real design work hasn't started.",
  },
  {
    title: "A bundled, fully offline mode",
    body:
      "Today Newton is cloud-backed end to end (see the FAQ). A bundled local model for fully offline use has been discussed as a future direction but has no real design or timeline yet.",
  },
];

export const metadata: Metadata = {
  title: "Roadmap — Newton",
  description: "What's genuinely planned next for Newton, honestly labeled — not a promise of when.",
};

export default function RoadmapPage() {
  return (
    <ContentPage>
      <ContentHero
        eyebrow="What's next"
        title="Roadmap"
        subtitle="Everything below is planned, not built. If you're looking for what's already real and shipped, see the changelog instead."
      />

      <section className={styles.section} aria-label="Planned">
        <div className={styles.grid}>
          {PLANNED_ITEMS.map((item) => (
            <div key={item.title} className={styles.card}>
              <span className={styles.badge}>Planned</span>
              <h2 className={styles.cardTitle}>{item.title}</h2>
              <p className={styles.cardBody}>{item.body}</p>
            </div>
          ))}
        </div>

        <p className={styles.note}>
          No dates here on purpose — these are real, prioritized ideas, not commitments
          with a delivery date. Some of these came from real, adversarial product
          critique passes against the actual codebase, not a brainstorm.
        </p>
      </section>
    </ContentPage>
  );
}
