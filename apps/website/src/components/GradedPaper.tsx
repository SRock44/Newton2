import styles from "./GradedPaper.module.css";

// The Study Mode scene's single dominant visual (product owner, three rejections in on
// an earlier "Verified, not vibes" card-grid version: "entire section is terrible and
// needs to be re-done"). One concrete idea instead: a piece of graded student work. The
// content is the real "math-catches-mistake" scenario captured from Newton's backend —
// the student wrote (x + 1)(x + 6), Newton's reply points out the middle term is wrong
// (1 + 6 = 7, not 5), and the computed correction is (x + 2)(x + 3). Nothing here is
// invented copy. Reused as-is (not rebuilt) by src/components/AppWalkthrough.tsx's
// first scene.
export default function GradedPaper() {
  return (
    <figure className={styles.paper}>
      <div className={styles.sheet}>
        <div className={styles.sheetHead}>
          <span className={styles.sheetLabel}>Homework — Factoring</span>
          <span className={styles.sheetMeta}>Problem 4</span>
        </div>

        <p className={styles.prompt}>Factor x² + 5x + 6</p>

        <div className={styles.workRow}>
          <span className={styles.workLabel}>You wrote:</span>
          <span className={styles.wrongAnswerWrap}>
            <span className={styles.wrongAnswer}>(x + 1)(x + 6)</span>
            <svg
              className={styles.strike}
              viewBox="0 0 190 26"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M4 21 C 44 7, 96 26, 138 9 S 176 3, 186 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </div>

        <div className={styles.margin}>
          <svg className={styles.marginCircle} viewBox="0 0 90 46" fill="none" aria-hidden="true">
            <path
              d="M8 24 C6 10, 30 3, 48 4 C74 5, 86 14, 84 26 C82 40, 56 44, 38 43 C16 42, 9 38, 8 24 Z"
              stroke="currentColor"
              strokeWidth="2.5"
            />
          </svg>
          <p className={styles.marginNote}>
            1 + 6 = 7, not 5 — <br className={styles.marginBreak} />
            wrong middle term.
          </p>
        </div>

        <div className={styles.correctionRow}>
          <svg className={styles.checkMark} viewBox="0 0 34 28" fill="none" aria-hidden="true">
            <path
              d="M3 15 L13 24 L31 3"
              stroke="currentColor"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className={styles.correctionText}>
            <span className={styles.correctAnswer}>(x + 2)(x + 3)</span>
            <span className={styles.correctionNote}>2 + 3 = 5 — checks out.</span>
          </div>
        </div>

        <div className={styles.stamp} aria-hidden="true">
          <span className={styles.stampLine1}>Verified</span>
          <span className={styles.stampLine2}>real symbolic computation</span>
        </div>
      </div>

      <figcaption className={styles.caption}>
        A reply from Newton&apos;s backend, laid out as a marked-up page.
      </figcaption>
    </figure>
  );
}
