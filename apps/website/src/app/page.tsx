import styles from "./page.module.css";

// Phase 1 foundation page: base layout + design tokens only. Real feature
// copy (Phase 3), sign-up/download routes (Phase 4), and the interactive
// demo (Phase 5) land in later phases — see WEBSITE-ROADMAP.md.
export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Newton</span>
      </header>

      <main className={styles.hero}>
        <h1 className={styles.title}>Newton</h1>
        <p className={styles.subtitle}>
          An Agentic Learning Environment: a native desktop study companion that connects to your
          real coursework, reads your syllabus to build a study plan, and solves problems with
          actual tools — code execution, symbolic math, web search, vision — showing its work
          step-by-step.
        </p>
        <p className={styles.note}>Sign-up and download links are coming soon.</p>
      </main>

      <footer className={styles.footer}>
        <p>Newton</p>
      </footer>
    </div>
  );
}
