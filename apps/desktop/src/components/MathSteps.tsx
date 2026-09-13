import { useEffect, useState } from "react";
import MessageContent from "./MessageContent";

interface MathStepsProps {
  json: string;
  /** Stable per-block key (see CodeBlock.tsx) used to persist how many steps the
   * student has revealed so far, so switching to another chat and back — or reopening
   * the app later — doesn't collapse progress back to just the first step. Omitted when
   * there's no stable identity to key against yet (e.g. a reply still streaming in). */
  storageKey?: string;
}

function parseSteps(json: string): string[] | null {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;
    if (!parsed.steps.every((s: unknown) => typeof s === "string")) return null;
    return parsed.steps;
  } catch {
    return null;
  }
}

function loadRevealed(storageKey: string | undefined, maxSteps: number): number {
  if (!storageKey) return 1;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw === null ? NaN : parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.min(parsed, maxSteps);
  } catch {
    // localStorage unavailable (private mode, etc.) — just fall back to step 1.
  }
  return 1;
}

/** Renders a step-by-step math derivation (as produced by the Tutor for a symbolic_math-
 * verified problem) one step at a time — a "Show next step" button reveals the next
 * entry instead of dumping the whole derivation at once, so the student can work through
 * it at their own pace rather than jumping straight to skimming the answer. Each step's
 * text goes through the same markdown+KaTeX pipeline as a chat message, so inline
 * `$LaTeX$` in a step renders correctly. */
function MathSteps({ json, storageKey }: MathStepsProps) {
  const steps = parseSteps(json);
  const [revealed, setRevealed] = useState(() => loadRevealed(storageKey, steps?.length ?? 1));

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, String(revealed));
    } catch {
      // Best-effort persistence only — a full/unavailable store shouldn't break reveal.
    }
  }, [storageKey, revealed]);

  if (!steps) {
    return <div className="math-steps math-steps--error">Couldn't render these steps.</div>;
  }

  const visibleCount = Math.min(revealed, steps.length);
  const hasMore = visibleCount < steps.length;
  const nextCount = visibleCount + 1;

  return (
    <div className="math-steps">
      {steps.slice(0, visibleCount).map((step, i) => (
        <div key={i} className="math-steps__step fade-up">
          <div className="math-steps__step-number eyebrow">Step {i + 1}</div>
          <MessageContent content={step} />
        </div>
      ))}
      {hasMore && (
        <button
          type="button"
          className="btn-primary math-steps__reveal"
          onClick={() => setRevealed((r) => Math.min(r + 1, steps.length))}
        >
          {/* Describes what clicking will reveal (the *next* count), not what's already
              on screen — "(1/5)" while already showing step 1 read as already-done. */}
          Show next step ({nextCount}/{steps.length})
        </button>
      )}
    </div>
  );
}

export default MathSteps;
