"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import Reveal from "@/components/Reveal";
import InteractiveDemo from "@/components/InteractiveDemo";
import FloatingNav from "@/components/FloatingNav";
import { FOOTER_COLUMNS } from "@/lib/siteNav";
import { appAuthUrl } from "@/lib/env";

// Phase 3: the real landing page. Every claim below is grounded in what's actually
// built (see ROADMAP.md's Phases 28-32 and services/api/app/tools/registry.py) — no
// invented features, no "coming soon" sections. Phase 4 (sign-up/download) is a
// separate, later phase; nav/CTA links that point at its unbuilt destination use "#"
// deliberately rather than a route that doesn't exist yet.
//
// Phase 3.8: a subtraction + rewrite pass, executing a literal work order distilled
// from three independent critique audits (a visual-density audit, a copywriting-voice
// audit, and a skeptical-first-time-visitor test) that converged on the same findings —
// the page was too long, too repetitive, and leaned on
// "real/actual/genuine/honest/verified" as a crutch word instead of letting the demo
// and the graded-paper visual carry the claims. This pass cut the "For Students"
// section (pure duplication of the feature list), collapsed the 13-card feature grid
// into a tight single-line capability list, shortened the Notepad/Pro sections, removed
// the redundant closing CTA, deduped the footer against the header nav, fixed a real
// mobile-nav bug (no way to reach Features/Pro/FAQ below 720px), and rewrote the
// worst instances of the repeated "[Claim]. Not/Never [alternative]." copy skeleton.
//
// Phase 3.9: the chat-transcript hero demo, the separate "Verified, not vibes"/
// GradedPaper section, and the separate Notepad section were replaced by one
// Supademo/Arcade-style stepped walkthrough (AppWalkthrough.tsx) — product owner,
// verbatim: "show off THE ACTUAL USEFUL FEATURES... WE ARE THE FIRST EVER AGENTIC
// LEARNING ENVIRONMENT." Three sections became one; see WEBSITE-ROADMAP.md's
// "Phase 3.9" entry for the real before/after numbers at the time.
//
// Phase 3.24 (this pass): that walkthrough (and the later ResearchFilmSection, both
// built on FilmPlayer — all three now deleted) didn't survive contact with the product
// owner actually looking at the live page: "far too PLAIN... like a shitty ass
// slideshow... remove the video stuff, use images or interactive user experiences...
// make the app look like a WEB APP, not just a MIRROR OF THE DESKTOP APP." Two
// autoplaying screen-recordings back to back, directly under a hero with no visual at
// all, was the specific, literal thing reading as "a slideshow." Replaced by
// InteractiveDemo.tsx (a real, clickable, web-native component, not a recording) right
// under the hero copy, and MomentsShowcase.tsx (four real screenshots) where the two
// film sections were. The plain-text capability list became an icon-card grid for the
// same "too plain" reason. Also: "POUND HEAVY INTO AGENTIC LEARNING ENVIRONMENT" — a
// badge above the eyebrow, not just a buried walkthrough-section kicker — and a
// "Chat Now" primary CTA (apps/web now exists; chatting needs no download at all).
//
// Phase 3.25 (this pass): MomentsShowcase itself didn't survive contact with the
// product owner either — "I hate the picture stuff as well... need to showcase
// features without a ton of shit on the screen, without looking like vibe-coded
// slop... look at your competitors... find a solid hybrid of all of them." Checked
// claude.com directly (fetched and read, not assumed from memory): its real marketing
// hero carries zero product screenshots at all — headline, subhead, one sign-in
// action, nothing else — the same restraint ChatGPT's and Perplexity's own marketing
// pages are well known for. A dense screenshot of the actual desktop app's title
// bar/sidebar/chrome, shrunk into a card, is exactly the opposite move from what every
// serious AI competitor's own page actually does. MomentsShowcase.tsx (+ its images) is
// deleted, not kept around unused. InteractiveDemo — a real interactive component, not a
// picture — stays; it's the one place a "show, don't just tell" instinct survives,
// because it's never a screenshot. The decorative hand-drawn CornerArrow nudge-to-CTA
// is also cut here: competitor marketing pages at this level carry near-zero
// illustrative ornament, and a doodle arrow pointing at a button reads closer to an
// indie-blog tutorial callout than a serious product's own confidence in its copy and
// whitespace. The capability cards also lose their heavy border/shadow/hover-lift
// treatment for the same flatter, lower-chrome reason — see page.module.css.

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

/** Small, restrained line-icon glyphs — one per capability card below. Pure inline SVG,
 * no image assets, matching this file's existing Squiggle/CornerArrow convention. */
function IconExact() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 14l3 3 6-11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13 12h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13 18h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconCode() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6L4 12l5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6l5 6-5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCards() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="4" width="13" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <rect x="4" y="9" width="13" height="11" rx="1.6" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconLibrary() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 4.5h8.5a1.5 1.5 0 011.5 1.5v14l-5.5-2.5L4 20V6a1.5 1.5 0 011-1.4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M15 7h4.5a1.5 1.5 0 011.5 1.5v12L17.5 18" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function IconFocus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 12c2.5-4.2 6-6.3 10-6.3s7.5 2.1 10 6.3c-2.5 4.2-6 6.3-10 6.3S4.5 16.2 2 12z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconVoice() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 11a7 7 0 0014 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 18v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// An icon-card grid — Phase 3.8 replaced the old 13-card, 5-subgroup feature grid with a
// tight text-only list on the theory that icons/cards were the worst instance of a
// repeated pattern; the product owner's own later review ("far too plain... like a
// slideshow") found the opposite problem — a six-line bulleted list with zero visual
// structure was the single biggest contributor to the page reading as plain. This
// restores a card per capability, but as ONE clean pattern (small line icon + short
// title + the same real claim as body copy), not the old 13-card/5-subgroup repetition —
// and reuses the exact card/hover treatment the Pro section below already establishes,
// not a new visual language. Every claim is unchanged from the plain-list version; only
// the presentation changed.
interface Capability {
  icon: ReactNode;
  title: string;
  body: string;
  /** Drives both the grid cell's span (CSS, see page.module.css's .capabilityGrid) and
   * which real decoration (if any) it gets — "big" and "wide" are the only two cells
   * large enough to carry one without it reading as cramped. Undefined = a plain 1x1
   * cell, same as every cell before this pass. */
  size?: "big" | "wide";
}

const CAPABILITIES: Capability[] = [
  {
    icon: <IconExact />,
    title: "Exact computation",
    body: "Symbolic math, linear algebra, chemistry, and statistics — solved exactly, not predicted.",
    size: "big",
  },
  {
    icon: <IconCode />,
    title: "Checks your work",
    body: "Runs your code against real test cases and checks proof structure step by step.",
  },
  {
    icon: <IconCards />,
    title: "Spaced repetition",
    body: "FSRS-scheduled flashcards, practice exams, and a weak-areas engine that closes the loop.",
  },
  {
    icon: <IconLibrary />,
    title: "A real document library",
    body: "A semester-spanning library with cross-document synthesis and inline annotation.",
  },
  {
    icon: <IconFocus />,
    title: "Focus Mode",
    body: "Holds back the answer until you ask — enforced server-side, not politely requested of the model.",
  },
  {
    icon: <IconVoice />,
    title: "Voice practice",
    body: "Spoken conversation practice and production-mode flashcards for language courses.",
    size: "wide",
  },
];

// Free tier, cut to the 3 items that matter most (Part 1's target: 3 max, down from 5).
const FREE_INCLUDES = [
  "Unlimited chatting with the tutor",
  "Every computation tool — math, chemistry, statistics, code and proof checking",
  "Flashcards, practice exams, the document library, and Focus Mode",
];

// Pro-exclusive features — every one confirmed gated behind billing_service.is_pro() in
// the real backend (app/services/billing.py's is_pro, reused by app/tools/
// write_research_paper.py, create_artifact.py, deep_research.py, study_session.py, and
// app/routers/voice.py). Titles only (Part 1 cuts the per-feature body paragraphs).
// Deliberately no dollar figure anywhere on this page — the real Pro price lives in
// Stripe config, not in this codebase. "Upgrade to Pro" links to "#" for the same
// Phase-4 reason every other sign-up/billing CTA on this page does: checkout isn't
// built yet.
const PRO_FEATURES = [
  "Full research paper writing",
  "AI-generated interactive artifacts",
  "Deep Research",
  "Composite study sessions",
  "Voice, including Conversation Practice",
  "Access to frontier AI models",
  "Higher generation limits",
];

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

      <FloatingNav />

      <main id="main">
        {/* ---------------------------------------------------------------- */}
        {/* Hero. Product owner, verbatim: "The demo should be on the        */}
        {/* LANDING page once once you go to the website" — now an          */}
        {/* InteractiveDemo widget directly beneath the hero copy, not a    */}
        {/* video scrolled to. "WE NEED TO POUND HEAVY INTO AGENTIC         */}
        {/* LEARNING ENVIRONMENT and... a 'CHAT NOW' button" — the badge    */}
        {/* above the eyebrow and the primary CTA below, respectively.      */}
        {/* ---------------------------------------------------------------- */}
        <div className={styles.heroShell}>
          <section className={styles.hero}>
            <p className={styles.aleBadge}>The first Agentic Learning Environment</p>
            <p className={styles.eyebrow}>Verified, not vibes</p>
            <h1 className={styles.title}>
              An AI tutor that{" "}
              <span className={styles.squiggleWrap}>
                <span className={styles.gradientText}>checks its work</span>
                <Squiggle />
              </span>{" "}
              — with real computation.
            </h1>
            <p className={styles.subtitle}>
              Newton solves problems with real tools — symbolic math, chemistry,
              statistics, your own code — instead of an LLM guessing. It remembers your
              whole semester.
            </p>
            <div className={styles.heroActions}>
              <a href={appAuthUrl("login")} className={styles.btnPrimary}>
                Chat Now
              </a>
              <a href="/download" className={styles.btnSecondary}>
                Download
              </a>
            </div>
            <p className={styles.heroNote}>
              No download required — chat right in your browser. Free to start.
            </p>

            <div className={styles.heroDemo}>
              <InteractiveDemo />
            </div>
          </section>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Capability cards — a bento grid: one featured 2x2 cell, a full-width wide   */}
        {/* cell, four plain 1x1 cells around them. Direct feedback on the previous     */}
        {/* uniform 3x2 grid: "WHAT IS THE POINT OF THIS? DO A BENTO OR SOMETHING       */}
        {/* CREATIVE, USE UP THE SPACE." The two non-uniform cells each carry one real  */}
        {/* piece of decoration (grounded in the same claim as their body copy, not     */}
        {/* invented) — see .capabilitySnippet/.capabilityBars in page.module.css.      */}
        {/* ---------------------------------------------------------------- */}
        <section id="features" className={`${styles.section} ${styles.sectionWarm}`} aria-labelledby="features-heading">
          <Reveal className={styles.sectionHead}>
            <p className={styles.eyebrow}>Capabilities</p>
            <h2 id="features-heading" className={styles.sectionTitle}>
              What it does.
            </h2>
          </Reveal>

          <div className={styles.capabilityGrid}>
            {CAPABILITIES.map((item, i) => (
              <Reveal
                key={item.title}
                className={`${styles.capabilityCard} ${
                  item.size === "big" ? styles.capabilityCardBig : item.size === "wide" ? styles.capabilityCardWide : ""
                }`}
                delayMs={i * 60}
              >
                {item.size === "wide" ? (
                  <>
                    <div className={styles.capabilityWideText}>
                      <span className={styles.capabilityIcon}>{item.icon}</span>
                      <h3 className={styles.capabilityTitle}>{item.title}</h3>
                      <p className={styles.capabilityBody}>{item.body}</p>
                    </div>
                    <div className={styles.capabilityBars} aria-hidden="true">
                      {Array.from({ length: 7 }).map((_, barIndex) => (
                        <span key={barIndex} style={{ animationDelay: `${barIndex * 0.12}s` }} />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <span className={styles.capabilityIcon}>{item.icon}</span>
                    <h3 className={styles.capabilityTitle}>{item.title}</h3>
                    <p className={styles.capabilityBody}>{item.body}</p>
                    {item.size === "big" && (
                      <div className={styles.capabilitySnippet}>
                        <span className={styles.capabilitySnippetBadge}>
                          <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.capabilitySnippetIcon}>
                            <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.18" />
                            <path
                              d="M6 10.5l2.5 2.5L14 7"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Verified
                        </span>
                        <code className={styles.capabilitySnippetCode}>∫ 2x dx = x² + C</code>
                      </div>
                    )}
                  </>
                )}
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Pro features — real Pro-exclusive capability, no invented price.  */}
        {/* ---------------------------------------------------------------- */}
        <section id="pro" className={`${styles.section} ${styles.sectionTextured}`} aria-label="Newton Pro">
          <Reveal className={styles.sectionHead}>
            <p className={styles.eyebrow}>Newton Pro</p>
            <p className={styles.sectionSubtitle}>
              Pro unlocks the tools that cost money to run per use — a compiled research
              paper, a synthesized web report, speech synthesis — plus more headroom on
              the generation tools everyone already gets.
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
                  <li key={feature} className={styles.proFeatureItem}>
                    <p className={styles.proFeatureTitle}>{feature}</p>
                  </li>
                ))}
              </ul>
              <a href="#" className={styles.btnPrimary}>
                Upgrade to Pro
              </a>
            </Reveal>
          </div>
        </section>
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
