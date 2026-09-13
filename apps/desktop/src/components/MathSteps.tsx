import { useState } from "react";
import MessageContent from "./MessageContent";

interface MathStepsProps {
  json: string;
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

/** Renders a step-by-step math derivation (as produced by the Tutor for a symbolic_math-
 * verified problem) one step at a time — a "Show next step" button reveals the next
 * entry instead of dumping the whole derivation at once, so the student can work through
 * it at their own pace rather than jumping straight to skimming the answer. Each step's
 * text goes through the same markdown+KaTeX pipeline as a chat message, so inline
 * `$LaTeX$` in a step renders correctly. */
function MathSteps({ json }: MathStepsProps) {
  const steps = parseSteps(json);
  const [revealed, setRevealed] = useState(1);

  if (!steps) {
    return <div className="math-steps math-steps--error">Couldn't render these steps.</div>;
  }

  const visibleCount = Math.min(revealed, steps.length);
  const hasMore = visibleCount < steps.length;

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
          Show next step ({visibleCount}/{steps.length})
        </button>
      )}
    </div>
  );
}

export default MathSteps;
