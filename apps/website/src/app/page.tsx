"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import Reveal from "@/components/Reveal";
import AppWalkthrough from "@/components/AppWalkthrough";
import { NAV_LINKS, FOOTER_COLUMNS } from "@/lib/siteNav";

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
// Phase 3.9 (this pass): the chat-transcript hero demo, the separate "Verified, not
// vibes"/GradedPaper section, and the separate Notepad section are replaced by one
// Supademo/Arcade-style stepped walkthrough (src/components/AppWalkthrough.tsx) —
// product owner, verbatim: "show off THE ACTUAL USEFUL FEATURES... WE ARE THE FIRST
// EVER AGENTIC LEARNING ENVIRONMENT." Three sections become one; see
// WEBSITE-ROADMAP.md's "Phase 3.9" entry for what changed and the real before/after
// numbers.

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

/** A tight hamburger icon for the mobile nav toggle. Purely decorative (the button
 * carries its own aria-label); the three bars are plain spans, not SVG, so they can
 * be styled/animated with CSS alone. */
function MenuIcon() {
  return (
    <span className={styles.menuToggleBars} aria-hidden="true">
      <span className={styles.menuToggleBar} />
      <span className={styles.menuToggleBar} />
      <span className={styles.menuToggleBar} />
    </span>
  );
}

// A tight, single-line capability list — Phase 3.8 replaces the old 13-card, 5-subgroup
// feature grid (a separate heading + blurb + 2-column card grid per subgroup) with this,
// per the density audit's finding that it was the worst instance of the repeated
// icon-less "heading + paragraph" card pattern on the page. Each line still traces back
// to a real, specific tool (see the removed FEATURE_GROUPS' history in git for exact
// grounding, unchanged by this rewrite — only the presentation and the copy voice
// changed, not the underlying claims).
const CAPABILITIES = [
  "Symbolic math, linear algebra, chemistry, and statistics, solved exactly.",
  "Runs your code against test cases and checks proof structure step by step.",
  "FSRS-scheduled flashcards, practice exams, and a weak-areas engine that closes the loop.",
  "A semester-spanning document library with cross-document synthesis and inline annotation.",
  "Focus Mode holds back the answer until you ask. Enforced server-side, not politely requested of the model.",
  "Spoken conversation practice and production-mode flashcards for language courses.",
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
            <button
              type="button"
              className={styles.menuToggle}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              <MenuIcon />
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav id="mobile-nav" className={styles.mobileNav} aria-label="Mobile">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={styles.mobileNavLink}
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <a href="#" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
              Sign In
            </a>
            <a
              href="#"
              className={styles.mobileNavLinkPrimary}
              onClick={() => setMobileMenuOpen(false)}
            >
              Sign Up
            </a>
          </nav>
        )}
      </header>

      <main id="main">
        {/* ---------------------------------------------------------------- */}
        {/* Hero. Product owner, verbatim: "The demo should be on the        */}
        {/* LANDING page once once you go to the website." AppWalkthrough    */}
        {/* (the app-in-use walkthrough) is the very next section, no other  */}
        {/* section between it and the hero.                                */}
        {/* ---------------------------------------------------------------- */}
        <div className={styles.heroShell}>
          <section className={styles.hero}>
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
              Newton solves problems with real tools — symbolic math, chemistry,
              statistics, your own code — instead of an LLM guessing. It remembers your
              whole semester.
            </p>
            <div className={styles.heroActions}>
              <a href="#" className={styles.btnPrimary}>
                Download Newton
              </a>
              <a href="#demo" className={styles.btnSecondary}>
                See how it works
              </a>
              <CornerArrow className={styles.cornerArrow} />
            </div>
            <p className={styles.heroNote}>Windows, macOS, and Linux. Free to start.</p>
          </section>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* The app walkthrough — replaces the old chat-transcript demo, the */}
        {/* "Verified, not vibes"/GradedPaper section, and the Notepad       */}
        {/* section with one Supademo-style stepped tour. See               */}
        {/* AppWalkthrough.tsx's own header comment.                        */}
        {/* ---------------------------------------------------------------- */}
        <AppWalkthrough />

        {/* ---------------------------------------------------------------- */}
        {/* Capability list — a tight, single-line-per-item list replacing   */}
        {/* the old 13-card / 5-subgroup feature grid.                      */}
        {/* ---------------------------------------------------------------- */}
        <section id="features" className={`${styles.section} ${styles.sectionWarm}`} aria-labelledby="features-heading">
          <Reveal className={styles.sectionHead}>
            <p className={styles.eyebrow}>Capabilities</p>
            <h2 id="features-heading" className={styles.sectionTitle}>
              What it does.
            </h2>
          </Reveal>

          <Reveal>
            <ul className={styles.capabilityList}>
              {CAPABILITIES.map((item) => (
                <li key={item} className={styles.capabilityItem}>
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
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
