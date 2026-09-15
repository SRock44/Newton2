import { useState } from "react";
import MathInput from "./MathInput";
import MessageContent from "./MessageContent";

/**
 * Fenced-block contract — Learn Mode's interactive step-by-step math flow (see
 * app/agents/tutor.py's LEARN_MODE_SYSTEM_ADDENDUM): instead of narrating a whole
 * math-steps derivation in one go, the Tutor presents only the current step as normal
 * text, then emits this block asking the student to attempt the NEXT step themselves:
 *
 * ```step-check
 * {
 *   "prompt": "Try expanding (x+3)^2 yourself"
 * }
 * ```
 *
 * - `prompt`: required, non-empty string — the instruction shown above the input.
 *
 * The input itself is a real WYSIWYG math field (MathInput.tsx, wrapping MathLive's
 * `<math-field>`), not a plain text box — a math-specific answer deserves math-specific
 * input assistance (live-rendered glyphs, a virtual keyboard with sqrt/exponent/
 * fraction/integral panels), same reasoning `Checkpoint.tsx` deliberately does NOT
 * share, since its comprehension-check answers are often prose, not pure math.
 *
 * Submitting (button click or Enter) sends the student's exact typed expression back
 * into the chat as LaTeX, wrapped in single `$...$` inline-math delimiters (confirmed
 * against MessageContent.tsx's remark-math/rehype-katex setup) and prefixed with
 * "My attempt: " — a distinctive, documented marker (NOT special-cased by any backend
 * parsing) that LEARN_MODE_SYSTEM_ADDENDUM tells the model to look for, so a plain
 * reading of the conversation is enough for it to recognize this as a step attempt
 * rather than a fresh, unrelated question. Keep this prefix in sync with the one named
 * in that addendum's text if it's ever changed here.
 *
 * Like OptionsPicker/PaperPlanCard, this component keeps no client-only "already
 * answered" flag (that would reset on reload) — whoever renders it decides that from
 * the surrounding conversation and passes it in as `answeredWith` (see CodeBlock.tsx /
 * ChatPane.tsx's `nextMessageContent`): the plain text of the chat message immediately
 * following this block's message, if one exists. Its mere presence means the student
 * already submitted an attempt, so the card locks read-only and shows what was sent.
 */
export const ATTEMPT_PREFIX = "My attempt: ";

interface StepCheckBlock {
  prompt: string;
}

interface StepCheckProps {
  json: string;
  onSend: (text: string) => void;
  /** Plain text of the chat message immediately following this block's own message, if
   * any — see the contract comment above for what this means and where it comes from. */
  answeredWith?: string;
}

function parseStepCheckBlock(json: string): StepCheckBlock | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.prompt !== "string" || !parsed.prompt.trim()) return null;
    return { prompt: parsed.prompt };
  } catch {
    return null;
  }
}

/** Strips the leading "My attempt: " marker off a follow-up message for display, if
 * present — an answered card shows the student's own words (rendered as real math, see
 * below), not the raw wire prefix. */
function displayAnswer(answeredWith: string): string {
  return answeredWith.startsWith(ATTEMPT_PREFIX) ? answeredWith.slice(ATTEMPT_PREFIX.length) : answeredWith;
}

function StepCheck({ json, onSend, answeredWith }: StepCheckProps) {
  const block = parseStepCheckBlock(json);
  const [draft, setDraft] = useState("");

  if (!block) {
    return <div className="step-check step-check--error">Couldn't render this step check.</div>;
  }

  const answered = answeredWith !== undefined;

  function submit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(`${ATTEMPT_PREFIX}$${trimmed}$`);
    setDraft("");
  }

  return (
    <div className={`step-check${answered ? " step-check--answered" : ""}`}>
      <div className="step-check__label">Your turn</div>
      <div className="step-check__prompt">{block.prompt}</div>
      {answered ? (
        // Routed through the normal markdown+KaTeX pipeline (the same one every chat
        // message uses) rather than a plain <div>, so a wrapped `$...$` attempt renders
        // as real typeset math here too, not raw LaTeX source text. Harmless for older/
        // malformed attempts with no math delimiters — those just render as plain text.
        <div className="step-check__answer">
          <MessageContent content={displayAnswer(answeredWith)} />
        </div>
      ) : (
        <div className="step-check__form">
          <MathInput
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            placeholder="Type your attempt…"
            ariaLabel="Your attempt"
          />
          <button
            type="button"
            className="btn-primary step-check__submit"
            onClick={submit}
            disabled={!draft.trim()}
          >
            Check my answer
          </button>
        </div>
      )}
    </div>
  );
}

export default StepCheck;
