"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import Reveal from "@/components/Reveal";
import HeroMockCard from "@/components/HeroMockCard";
import DemoTranscript from "@/components/DemoTranscript";
import { NAV_LINKS, FOOTER_COLUMNS } from "@/lib/siteNav";

// Phase 3: the real landing page. Every claim below is grounded in what's actually
// built (see ROADMAP.md's Phases 28-32 and services/api/app/tools/registry.py) — no
// invented features, no "coming soon" sections. Phase 4 (sign-up/download) is a
// separate, later phase; nav/CTA links that point at its unbuilt destination use "#"
// deliberately rather than a route that doesn't exist yet.
//
// Phase 3.5 (this pass): a visual/motion overhaul — a wider but still cohesive color
// story, real scroll-triggered and hover motion (all respecting prefers-reduced-motion),
// and some real personality — plus Phase 5's "scripted" interactive demo (see
// DemoTranscript.tsx), replaying REAL captured transcripts client-side. No new capability
// claims, no live backend calls; see WEBSITE-ROADMAP.md.

const HOW_IT_WORKS = [
  {
    eyebrow: "Symbolic Math",
    prompt: "Factor x² + 5x + 6",
    result: "(x + 2)(x + 3)",
    detail:
      "Computed exactly with real symbolic algebra (SymPy) — not a pattern the model recognizes from training, an answer it actually derived.",
    badge: "Verified",
  },
  {
    eyebrow: "Chemistry",
    prompt: "Balance C₃H₈ + O₂ → CO₂ + H₂O",
    result: "C₃H₈ + 5O₂ → 3CO₂ + 4H₂O",
    detail:
      "Solved with real linear algebra over the element-composition matrix. If a system is underdetermined, Newton says so instead of guessing coefficients.",
    badge: "Verified",
  },
  {
    eyebrow: "Research Papers",
    prompt: "A citation in your draft paper",
    result: "Checked against the source's real fetched text",
    detail:
      "Every citation is scored for real support in the source it points to, and flagged honestly — grounded, ungrounded, or never actually fetched — not just formatted correctly.",
    badge: "Grounding checked",
  },
];

type FeatureItem = { title: string; description: string };
type FeatureGroup = { name: string; blurb: string; items: FeatureItem[] };

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    name: "Verified Computation",
    blurb: "The same standard, extended past algebra: a real answer, or an honest “I can't verify this.”",
    items: [
      {
        title: "Symbolic math & linear algebra",
        description:
          "Solve, differentiate, integrate, simplify, factor, and expand exactly, plus real determinants, inverses, eigenvalues, and null spaces.",
      },
      {
        title: "Real chemistry",
        description:
          "Balance any equation, work stoichiometry with real atomic weights, and solve gas-law and pH problems exactly — not restated word problems.",
      },
      {
        title: "Numeric methods & statistics",
        description:
          "Root-finding, curve fitting, ODE integration, and ill-conditioned systems, plus real t-tests, regression, ANOVA, and chi-square with real p-values.",
      },
      {
        title: "Checks your code and your proofs",
        description:
          "Runs your own code against real tests in a sandbox and reports what happened. Critiques proof structure — induction, contradiction, contrapositive, case analysis — verifying every algebraic sub-step for real.",
      },
    ],
  },
  {
    name: "Real Memory & Progress Tracking",
    blurb: "A whole semester of your own performance, actually put to use.",
    items: [
      {
        title: "FSRS-scheduled flashcards",
        description:
          "Spaced repetition scheduled by the same forgetting-curve science serious memory research uses, in recognition and typed-recall (production) modes.",
      },
      {
        title: "Practice exams that remember",
        description:
          "Full exams generated from your material, with every missed question logged permanently instead of graded once and forgotten.",
      },
      {
        title: "A weak-areas engine that closes the loop",
        description:
          "Tracks your real performance across the term and opens a pre-filtered review queue for exactly the cards and questions you're weak on.",
      },
    ],
  },
  {
    name: "Real Document Understanding",
    blurb: "A persistent library that gets smarter as your semester fills up, not a chat that forgets when it ends.",
    items: [
      {
        title: "A semester-spanning document library",
        description:
          "Everything you upload stays retrievable — searched, quoted, and reasoned over — for the rest of the term, not just this conversation.",
      },
      {
        title: "Cross-document synthesis & annotation",
        description:
          "Ask a question that spans several readings and get an answer that actually draws from each of them, or highlight a passage in any document and get an explanation attached right there.",
      },
    ],
  },
  {
    name: "Honest by Design",
    blurb: "Trust mechanisms built into the backend, not promises the model makes you.",
    items: [
      {
        title: "Server-enforced Focus Mode",
        description:
          "Turn it on and the backend itself — not a politely-asked model — holds back the final answer until you actually ask for it.",
      },
      {
        title: "A visible Verified badge",
        description:
          "Every chat reply tells you plainly whether it came from real computation or a reasoned judgment call. No guessing which one you got.",
      },
    ],
  },
  {
    name: "Real Language Practice",
    blurb: "Actual spoken practice, not text dictated into a box.",
    items: [
      {
        title: "Conversation Practice",
        description:
          "Turn-based spoken roleplay in your target language, with real multi-language text-to-speech and gentle in-context corrections.",
      },
      {
        title: "Production-mode flashcards",
        description:
          "Recognition cards show you the term; production cards make you actually type it from the definition, graded with a diacritic-aware comparison.",
      },
    ],
  },
];

const STUDENT_CARDS = [
  {
    major: "Math",
    headline: "Real per-step math, not just final answers.",
    description:
      "Newton pinpoints exactly which step in your algebra or calculus went wrong and walks you up a real hint ladder before giving anything away. Proof structure gets checked too — induction, contradiction, contrapositive, case analysis — with every algebraic sub-step computationally verified.",
  },
  {
    major: "Computer Science",
    headline: "Checks your code. Never writes it for you.",
    description:
      "Run your own program against real tests in a real sandbox and get back exactly which ones passed, which failed, and why — the same discipline as checking a math answer, extended to code, deliberately never a tool that edits your project for you.",
  },
  {
    major: "Engineering & Natural Sciences",
    headline: "Real numbers for real coursework.",
    description:
      "Balance a chemical equation with real linear algebra, run a stoichiometry problem with real atomic weights, or solve an ill-conditioned system with a numeric solver that tells you honestly when a matrix is poorly conditioned — the actual content of a chem, physics, or statics course.",
  },
  {
    major: "Social Sciences",
    headline: "Real inferential statistics, not a definition of one.",
    description:
      "Run an actual t-test, correlation, regression, chi-square, or ANOVA on your own data and get real coefficients, real p-values, and a real expected-frequency table — the actual shape of an empirical-methods course.",
  },
  {
    major: "Humanities",
    headline: "Papers that cite honestly.",
    description:
      "Compile a real IEEE, APA7, MLA, or Chicago paper, and every cited claim gets checked against the real fetched text of its source — flagged plainly if a citation doesn't actually say what the paper claims it says.",
  },
  {
    major: "World Languages",
    headline: "Actual spoken practice, not dictation.",
    description:
      "Turn-based conversation practice in your target language with real text-to-speech and gentle corrections, plus production-mode flashcards that make you actually produce the word instead of just recognizing it.",
  },
];

// Pro-exclusive features — every one confirmed gated behind billing_service.is_pro() in
// the real backend (app/services/billing.py's is_pro, reused by app/tools/
// write_research_paper.py, create_artifact.py, deep_research.py, study_session.py, and
// app/routers/voice.py). Deliberately no dollar figure anywhere on this page — the real
// Pro price lives in Stripe config, not in this codebase, and isn't something this site
// can honestly state. "Upgrade to Pro" links to "#" for the same Phase-4 reason every
// other sign-up/billing CTA on this page does: checkout isn't built yet.
const FREE_INCLUDES = [
  "Unlimited chatting with the tutor — no daily or weekly cap",
  "Every verified-computation tool: symbolic math, real chemistry, statistics, numeric methods, code and proof checking",
  "Flashcards scheduled with FSRS, plus practice exams and study plans — up to about 5 items per generation",
  "The semester-spanning document library, cross-document synthesis, and the Notepad",
  "Focus Mode and Learn Mode, and the weak-areas engine",
];

const PRO_FEATURES = [
  {
    title: "Full research paper writing",
    description:
      "A plan-then-approve workflow that compiles a real, cited LaTeX paper — MLA, Chicago, IEEE, or APA7 — to PDF, with every citation checked against the real fetched text of its source.",
  },
  {
    title: "AI-generated interactive artifacts",
    description:
      "Diagrams, charts, slideshows, interactive demos, and quiz games, built to your actual material rather than a generic template.",
  },
  {
    title: "Deep Research",
    description:
      "A standalone tool that synthesizes a cited report from several real web sources for an open question, in one turn — no paper planning or LaTeX involved.",
  },
  {
    title: "Composite study sessions",
    description:
      "One request fans out a full study plan, flashcards, and a practice exam concurrently, then composes one summary — instead of generating each piece separately.",
  },
  {
    title: "Voice, including Conversation Practice",
    description:
      "Real speech-to-text and text-to-speech, plus turn-based spoken roleplay practice in your target language with gentle in-context corrections.",
  },
  {
    title: "Access to frontier AI models",
    description:
      "Route harder problems to a stronger model than the free-tier default, with a monthly usage allowance.",
  },
  {
    title: "Higher generation limits",
    description:
      "About 15 items per flashcard, practice-exam, or study-plan generation instead of about 5 — more material per request, not a different tool.",
  },
];

/** A hand-drawn-style wavy underline, dropped beneath a key phrase. Purely decorative. */
function Squiggle() {
  return (
    <svg className={styles.squiggle} viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M1 8 Q 12 1, 24 8 T 49 8 T 74 8 T 99 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A hand-drawn-style circle scribble, drawn around a key phrase. Purely decorative. */
function CircleScribble() {
  return (
    <svg className={styles.circleAccent} viewBox="0 0 120 60" fill="none" aria-hidden="true">
      <path
        d="M10 30 C10 10, 40 3, 60 4 C90 5, 112 15, 110 32 C108 50, 78 57, 55 56 C25 55, 8 48, 10 30 Z"
        stroke="currentColor"
        strokeWidth="3"
      />
    </svg>
  );
}

/** A small hand-drawn-style arrow, nudging toward the secondary CTA. Purely decorative. */
function CornerArrow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 46 34" fill="none" aria-hidden="true">
      <path
        d="M2 3 C 16 4, 32 8, 40 22"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M29 20 L40 22 L36 11"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export default function Home() {
  // A small, tasteful easter egg for anyone curious enough to open the console — not
  // required by anything, doesn't affect the honest-claims surface of the page itself.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(
      "%cVerified, not vibes.%c You found the source. Newton's apple is in the header — try hovering the wordmark.",
      "font-family: serif; font-size: 14px; font-weight: 600; color: #2f4d8c;",
      "font-family: sans-serif; font-size: 12px; color: inherit;"
    );
  }, []);

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.wordmarkWrap}>
            <a href="#" className={styles.wordmark}>
              Newton
            </a>
            <span className={styles.wordmarkApple} aria-hidden="true">
              🍎
            </span>
          </span>

          <nav className={styles.nav} aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <Link key={link.label} href={link.href} className={styles.navLink}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className={styles.headerActions}>
            <a href="#" className={styles.navLinkAuth}>
              Sign In
            </a>
            <a href="#" className={styles.btnPrimarySm}>
              Sign Up
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ---------------------------------------------------------------- */}
        {/* Hero                                                             */}
        {/* ---------------------------------------------------------------- */}
        <div className={styles.heroShell}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>Verified, not vibes</p>
              <h1 className={styles.title}>
                An AI tutor that{" "}
                <span className={styles.squiggleWrap}>
                  checks its work
                  <Squiggle />
                </span>{" "}
                — with real computation.
              </h1>
              <p className={styles.subtitle}>
                Newton is a native desktop study companion that solves problems with actual
                tools — symbolic math, real chemistry, statistics, and your own code — instead
                of an LLM guessing what sounds right. It remembers your whole semester, so
                review time goes exactly where you&apos;re actually weak.
              </p>
              <div className={styles.heroActions}>
                <a href="#" className={styles.btnPrimary}>
                  Download Newton
                </a>
                <a href="#verified" className={styles.btnSecondary}>
                  See how it works
                </a>
                <CornerArrow className={styles.cornerArrow} />
              </div>
              <p className={styles.heroNote}>Windows, macOS, and Linux. Free to start.</p>
            </div>

            <div className={styles.heroVisual} aria-hidden="true">
              <HeroMockCard />
            </div>
          </section>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Verified, not vibes                                              */}
        {/* ---------------------------------------------------------------- */}
        <section id="verified" className={styles.section}>
          <Reveal className={styles.sectionHeadEditorial}>
            <div>
              <p className={styles.eyebrow}>How it works</p>
              <h2 className={styles.sectionHeadEditorialTitle}>
                <span className={styles.circleWrap}>
                  Verified
                  <CircleScribble />
                </span>
                , not vibes.
              </h2>
            </div>
            <p className={`${styles.sectionSubtitle} ${styles.sectionHeadEditorialSubtitle}`}>
              Most AI tutors tell you an answer sounds right. Newton computes it — and
              tells you, plainly, when it did.
            </p>
          </Reveal>

          <div className={styles.exampleGrid}>
            {HOW_IT_WORKS.map((example, i) => (
              <Reveal
                key={example.eyebrow}
                delayMs={i * 90}
                className={
                  i === 0 ? styles.exampleSlotWide : i === 1 ? styles.exampleSlotNarrow : styles.exampleSlotFull
                }
              >
                <div className={styles.exampleCard}>
                  <p className={styles.exampleEyebrow}>{example.eyebrow}</p>
                  <p className={styles.examplePrompt}>{example.prompt}</p>
                  <div className={styles.exampleArrow} aria-hidden="true">
                    &darr;
                  </div>
                  <p className={styles.exampleResult}>{example.result}</p>
                  <p className={styles.exampleDetail}>{example.detail}</p>
                  <span className={styles.verifiedBadge}>
                    <svg viewBox="0 0 16 16" className={styles.verifiedIcon} focusable="false">
                      <path
                        fill="currentColor"
                        d="M6.5 11.5 3 8l1.06-1.06L6.5 9.38l5.44-5.44L13 5l-6.5 6.5Z"
                      />
                    </svg>
                    {example.badge}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>

          <p className={styles.sectionFootnote}>
            And when there&apos;s no algorithm for deciding something — a proof&apos;s
            logical validity, an argument&apos;s quality — Newton says so honestly instead
            of pretending a judgment call is a computed fact.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Interactive demo (Phase 5, scripted half): real captured          */}
        {/* transcripts, replayed client-side — no live backend call.        */}
        {/* ---------------------------------------------------------------- */}
        <section id="demo" className={`${styles.section} ${styles.sectionTextured}`}>
          <Reveal className={styles.sectionHead}>
            <p className={styles.eyebrow}>Real sessions, replayed</p>
            <h2 className={styles.sectionTitle}>Watch Newton verify something, for real.</h2>
            <p className={styles.sectionSubtitle}>
              These are real transcripts captured from Newton&apos;s actual backend — the
              same tool calls, the same verified flags, the same streamed reply text, just
              replayed here instead of over a live connection.
            </p>
          </Reveal>

          <Reveal>
            <DemoTranscript />
          </Reveal>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Feature grid                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section className={`${styles.section} ${styles.sectionWarm}`} aria-labelledby="features-heading">
          <Reveal className={styles.sectionHead}>
            <p className={styles.eyebrow}>Everything, actually built</p>
            <h2 id="features-heading" className={styles.sectionTitle}>
              Real capability, organized honestly.
            </h2>
          </Reveal>

          <div className={styles.featureGroups}>
            {FEATURE_GROUPS.map((group, i) => (
              <Reveal key={group.name} delayMs={Math.min(i, 3) * 70}>
                <div className={styles.featureGroup}>
                  <div className={styles.featureGroupHead}>
                    <h3 className={styles.featureGroupName}>{group.name}</h3>
                    <p className={styles.featureGroupBlurb}>{group.blurb}</p>
                  </div>
                  <div className={styles.featureItemGrid}>
                    {group.items.map((item) => (
                      <div key={item.title} className={styles.featureItem}>
                        <h4 className={styles.featureItemTitle}>{item.title}</h4>
                        <p className={styles.featureItemDescription}>{item.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Notepad in class                                                 */}
        {/* ---------------------------------------------------------------- */}
        <section className={`${styles.notepadSection} ${styles.sectionTextured}`} aria-labelledby="notepad-heading">
          <Reveal className={styles.notepadCopy}>
            <p className={styles.eyebrow}>The Notepad</p>
            <h2 id="notepad-heading" className={styles.sectionTitle}>
              Take live lecture notes. Never lose the thread.
            </h2>
            <p className={styles.notepadParagraph}>
              You&apos;re in lecture and the professor has already moved on before
              you&apos;ve processed the last definition. Type your notes in Newton the way
              you always have. The moment something doesn&apos;t click, highlight it right
              there in your notes and ask Newton to explain — the explanation appears
              inline, grounded in your own notes and documents, without you ever leaving the
              page or breaking your train of thought.
            </p>
            <p className={styles.notepadParagraph}>
              Every note is saved, named, and retrievable the same way your uploaded
              readings are — so &ldquo;explain the thing my professor said about
              hysteresis&rdquo; actually finds it, three weeks later, the night before the
              exam.
            </p>
          </Reveal>

          <Reveal className={styles.notepadVisual} delayMs={120}>
            <div className={styles.notepadCard} aria-hidden="true">
              <p className={styles.notepadCardTitle}>Lecture 14 — Electromagnetism</p>
              <p className={styles.notepadCardBody}>
                Hysteresis loops show how magnetization lags the applied field.{" "}
                <span className={styles.notepadHighlight}>
                  the coercive field is path-dependent
                </span>{" "}
                &mdash; depends on the material&apos;s prior magnetic history, not just its
                current state.
              </p>
              <div className={styles.notepadPopover}>
                <p className={styles.notepadPopoverLabel}>Explain this</p>
                <p className={styles.notepadPopoverBody}>
                  Path-dependent means the field needed to bring magnetization back to zero
                  depends on how the material got there, not only where &ldquo;there&rdquo;
                  is &mdash; that&apos;s exactly what a hysteresis loop is plotting.
                </p>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Built for every student                                         */}
        {/* ---------------------------------------------------------------- */}
        <section id="for-students" className={styles.section}>
          <Reveal className={styles.sectionHead}>
            <p className={styles.eyebrow}>For Students</p>
            <h2 className={styles.sectionTitle}>Built for every student.</h2>
            <p className={styles.sectionSubtitle}>
              Newton was reviewed major-by-major by skeptical-student critique passes
              before anything here was written. What it&apos;s actually good at, by major:
            </p>
          </Reveal>

          <div className={styles.studentGrid}>
            {STUDENT_CARDS.map((card, i) => (
              <Reveal key={card.major} delayMs={Math.min(i, 5) * 60}>
                <div className={styles.studentCard}>
                  <p className={styles.studentMajor}>{card.major}</p>
                  <h3 className={styles.studentHeadline}>{card.headline}</h3>
                  <p className={styles.studentDescription}>{card.description}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal className={styles.calloutStrip}>
            <p>
              <strong>Starting from zero, or grinding for a test?</strong> Generate a full
              study plan, flashcards, and a practice exam from just a topic — SAT, GRE,
              MCAT, or anything else — no document required. The weak-areas engine takes it
              from there.
            </p>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Pro features — real Pro-exclusive capability, no invented price.  */}
        {/* ---------------------------------------------------------------- */}
        <section id="pro" className={`${styles.section} ${styles.sectionTextured}`} aria-labelledby="pro-heading">
          <Reveal className={styles.sectionHead}>
            <p className={styles.eyebrow}>Newton Pro</p>
            <h2 id="pro-heading" className={styles.sectionTitle}>
              Everything free, plus the expensive tools.
            </h2>
            <p className={styles.sectionSubtitle}>
              Pro unlocks the tools that cost real money to run per use — a compiled
              research paper, a synthesized web report, real speech synthesis — plus more
              headroom on the generation tools everyone already gets.
            </p>
          </Reveal>

          <div className={styles.proGrid}>
            <Reveal className={styles.proColumn}>
              <p className={styles.proColumnLabel}>Free</p>
              <ul className={styles.proList}>
                {FREE_INCLUDES.map((item) => (
                  <li key={item} className={styles.proListItem}>
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal className={styles.proColumnPro} delayMs={90}>
              <p className={styles.proColumnLabelPro}>Pro</p>
              <ul className={styles.proFeatureList}>
                {PRO_FEATURES.map((feature) => (
                  <li key={feature.title} className={styles.proFeatureItem}>
                    <p className={styles.proFeatureTitle}>{feature.title}</p>
                    <p className={styles.proFeatureDescription}>{feature.description}</p>
                  </li>
                ))}
              </ul>
              <a href="#" className={styles.btnPrimary}>
                Upgrade to Pro
              </a>
            </Reveal>
          </div>

          <p className={styles.sectionFootnote}>
            No price shown here on purpose — checkout isn&apos;t built into this site yet,
            and we&apos;d rather leave this blank than guess.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Closing CTA                                                      */}
        {/* ---------------------------------------------------------------- */}
        <div className={styles.closingShell}>
          <Reveal className={styles.closingSection}>
            <h2 className={styles.closingTitle}>Study with something that checks its work.</h2>
            <p className={styles.closingSubtitle}>
              Free to start, on Windows, macOS, and Linux.
            </p>
            <a href="#" className={styles.btnPrimary}>
              Download Newton
            </a>
          </Reveal>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <p className={styles.wordmark}>Newton</p>
            <p className={styles.footerTagline}>Verified, not vibes.</p>
          </div>

          <div className={styles.footerColumns}>
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading} className={styles.footerColumn}>
                <p className={styles.footerColumnHeading}>{column.heading}</p>
                <ul className={styles.footerLinkList}>
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className={styles.footerLink}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.footerBottom}>
          <p>&copy; {new Date().getFullYear()} Newton. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
