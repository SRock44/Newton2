import { useState } from "react";
import type { KeyboardEvent } from "react";

/**
 * Fenced-block contract — Learn Mode's comprehension-check pause (see
 * app/agents/tutor.py's LEARN_MODE_SYSTEM_ADDENDUM): after a substantive conceptual
 * explanation, the Tutor pauses and emits this block with a real question checking
 * understanding before continuing, in the same Socratic spirit as Focus Mode but for
 * explanations generally, not just problem-solving:
 *
 * ```checkpoint
 * {
 *   "question": "Why does the exponent on the denominator become negative?"
 * }
 * ```
 *
 * - `question`: required, non-empty string — the comprehension-check question shown.
 *
 * Submitting (button click or Enter) sends the student's exact typed answer back into
 * the chat as a plain message — unlike StepCheck's "My attempt: " marker, a checkpoint
 * answer reads naturally as a normal reply to the question just asked, so no prefix is
 * needed for the model to understand it in context.
 *
 * Same reload-safety pattern as OptionsPicker/PaperPlanCard/StepCheck: no client-only
 * "already answered" flag, since that would reset on reload. The caller passes in
 * `answeredWith` (see CodeBlock.tsx / ChatPane.tsx's `nextMessageContent`) — the plain
 * text of the chat message immediately following this block's own message, if any —
 * and its mere presence locks the card read-only, showing what was actually sent.
 *
 * Visually distinct from StepCheck (different label/icon/accent color — see
 * App.css's `.checkpoint` rules using `--color-info`) so a student can tell "this is a
 * concept check" apart from "this is a math step attempt" at a glance.
 */
interface CheckpointBlock {
  question: string;
}

interface CheckpointProps {
  json: string;
  onSend: (text: string) => void;
  /** Plain text of the chat message immediately following this block's own message, if
   * any — see the contract comment above for what this means and where it comes from. */
  answeredWith?: string;
}

function parseCheckpointBlock(json: string): CheckpointBlock | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.question !== "string" || !parsed.question.trim()) return null;
    return { question: parsed.question };
  } catch {
    return null;
  }
}

function Checkpoint({ json, onSend, answeredWith }: CheckpointProps) {
  const block = parseCheckpointBlock(json);
  const [draft, setDraft] = useState("");

  if (!block) {
    return <div className="checkpoint checkpoint--error">Couldn't render this checkpoint.</div>;
  }

  const answered = answeredWith !== undefined;

  function submit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className={`checkpoint${answered ? " checkpoint--answered" : ""}`}>
      <div className="checkpoint__label">Quick check</div>
      <div className="checkpoint__question">{block.question}</div>
      {answered ? (
        <div className="checkpoint__answer">{answeredWith}</div>
      ) : (
        <div className="checkpoint__form">
          <input
            type="text"
            className="checkpoint__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Your answer…"
            aria-label="Your answer"
          />
          <button
            type="button"
            className="btn-primary checkpoint__submit"
            onClick={submit}
            disabled={!draft.trim()}
          >
            Answer
          </button>
        </div>
      )}
    </div>
  );
}

export default Checkpoint;
