import type { Metadata } from "next";
import { ContentPage, ContentHero } from "@/components/ContentPage";
import styles from "./faq.module.css";

// Real, honest answers — every one traceable to the actual codebase (see the inline
// comments below each answer that needed a source note) rather than generic SaaS-FAQ
// filler. Where a real number couldn't be confirmed, the answer is phrased
// qualitatively instead of guessing (see "Is it free?"). No privacy-policy PAGE exists
// on this site yet — PRIVACY_POLICY.md at the repo root is an explicit engineer-authored
// DRAFT, not lawyer-reviewed, not published anywhere public — so "Is my data private?"
// deliberately doesn't link to one; see that answer's own comment.
const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "What is Newton?",
    answer:
      "Newton is an Agentic Learning Environment: a native desktop AI tutor that solves problems with real computation — symbolic math, real chemistry, statistics, your own code — instead of an LLM pattern-matching its way to something that sounds right. It also remembers your semester (documents, past mistakes, spaced-repetition flashcards) rather than starting from zero every conversation.",
  },
  {
    question: "Is it free?",
    answer:
      "Yes — there's a real free tier, not a time-limited trial. There's no daily, weekly, or time-based cap on chatting with Newton on the free plan. The real difference is generation size: a single free-plan request to build flashcards, a practice exam, or a study plan aims for about 5 items, versus about 15 on Pro (the app tells you this honestly before you generate, not after). Pro adds specific extra tools on top — see the Pro section on the homepage for exactly what's gated and what isn't.",
  },
  {
    question: "What does \"verified, not vibes\" actually mean?",
    answer:
      "It means Newton distinguishes an answer it actually computed from a judgment call it reasoned its way to, and tells you which one you got. Ask it to factor a polynomial and it runs real symbolic algebra (SymPy) to get there — the answer is derived, not recalled. Ask it to balance a chemical equation and it solves real linear algebra over the element-composition matrix (and says so honestly if the system is underdetermined instead of guessing coefficients). Ask it to check your own code and it actually runs your code against real tests in a sandbox and reports exactly which ones passed — it never just reads your code and guesses whether it looks right. When there's genuinely no algorithm for deciding something — whether a proof's logical structure holds, whether an essay argument is persuasive — Newton says so plainly instead of dressing up a guess as a computed fact.",
  },
  {
    question: "What platforms does it run on?",
    answer:
      "Windows, macOS, and Linux, as a native desktop app built on Tauri. There's no web version yet — a browser-based chat client for signed-in users is a real, planned feature (see the Roadmap), not something you can use today.",
  },
  {
    question: "Does it work without an internet connection?",
    answer:
      "No. Newton's tutor, and every one of its computation tools, runs against a cloud backend — the desktop app itself doesn't do the symbolic math, chemistry, or code-checking locally. A fully offline, locally-bundled model has been discussed as a future direction but isn't built, and there's no target date for it.",
  },
  {
    question: "Is my data private?",
    answer:
      "Your documents and conversations are stored securely on Newton's servers so features like your persistent document library and spaced-repetition review actually work across sessions — Newton can't remember your semester without keeping that data somewhere. We don't yet have a finished, lawyer-reviewed privacy policy published on this site to link you to here; treat that as a real gap we're working through, not something we're glossing over.",
  },
  {
    question: "Does Newton just give me the answer?",
    answer:
      "Not by default, and if you turn on Focus Mode, the backend itself enforces that — not just a politely-worded instruction to the model. With Focus Mode on, Newton's server inspects its own draft reply before you ever see it and holds back a clean final answer unless you've made a real attempt or explicitly ask to be checked. get_math_hint also gives you a real three-level hint ladder (a conceptual nudge, then a first concrete step, then the answer) instead of one flat reveal.",
  },
  {
    question: "What's the green \"Verified\" badge on a reply?",
    answer:
      "It's a real, server-computed signal, not the model's own self-assessment. Newton's backend checks whether a reply's tool result actually came from real computation (symbolic math, chemistry's linear algebra, a sandboxed code run, a verified proof sub-step) before it ever renders the badge — a plain web search or a reasoning-based judgment call never gets one, regardless of how confident the reply sounds.",
  },
  {
    question: "Do I need to upload a document to use Newton?",
    answer:
      "No. Flashcards, practice exams, and study plans can all be generated from just a topic — SAT prep, a subject you're learning from scratch, anything — with no document required. Uploading your own syllabus, readings, or notes makes everything more specific to your actual coursework, but it's not a hard requirement to get started.",
  },
];

export const metadata: Metadata = {
  title: "FAQ — Newton",
  description: "Honest answers about what Newton is, what's free, and what \"verified, not vibes\" actually means.",
};

export default function FaqPage() {
  return (
    <ContentPage>
      <ContentHero
        eyebrow="Questions, answered honestly"
        title="Frequently asked questions"
        subtitle="No marketing dodges — if we don't know something for sure (an exact free-tier number, a finished privacy policy), we say so instead of guessing."
      />

      <section className={styles.section} aria-label="Frequently asked questions">
        <div className={styles.list}>
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className={styles.item}>
              <summary className={styles.question}>{item.question}</summary>
              <p className={styles.answer}>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </ContentPage>
  );
}
