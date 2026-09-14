import { useState } from "react";

/**
 * Fenced-block contract — a general "pick 1 of up to 4" question, e.g. for picking a
 * citation style or template during paper planning, but not specific to that:
 *
 * ```options
 * {
 *   "question": "Which citation style should this paper use?",
 *   "options": [
 *     { "label": "IEEE", "description": "Numbered references, standard for engineering/CS conferences.", "recommended": true },
 *     { "label": "APA 7", "description": "Author-date references, standard for humanities/social sciences." }
 *   ],
 *   "multiSelect": false
 * }
 * ```
 *
 * - `question`: required, non-empty string — the prompt shown above the option cards.
 * - `options`: required, 1-4 entries. Each needs a non-empty `label`; `description`
 *   (shown under the label) and `recommended` (visually distinguishes the card) are
 *   both optional. More than one entry may set `recommended` — each gets the same
 *   treatment — but a single recommended pick is the intended use.
 * - `multiSelect`: optional, defaults to false.
 *   - false: clicking a card immediately sends that option's exact `label` text as the
 *     outgoing chat message.
 *   - true: cards become checkboxes; a "Confirm" button (disabled until at least one is
 *     checked) sends the picked labels, in the order given, joined with ", ".
 *
 * No language-model-facing "answer" format beyond that: the reply is always just the
 * label text(s), verbatim, exactly as if the student had typed them.
 *
 * This component keeps no client-only "already answered" flag (that would reset on
 * reload) — instead, whoever renders it decides that from the surrounding conversation
 * and passes it in as `answeredWith` (see CodeBlock.tsx / ChatPane.tsx): the plain text
 * of the chat message immediately following this block's message, if one exists. Its
 * mere presence means the question was answered (picking always immediately sends a
 * follow-up message), so the card locks read-only; when that text also happens to match
 * option label(s) exactly, those are shown as the picked answer.
 */
interface Option {
  label: string;
  description?: string;
  recommended?: boolean;
}

interface OptionsBlock {
  question: string;
  options: Option[];
  multiSelect: boolean;
}

interface OptionsPickerProps {
  json: string;
  onSend: (text: string) => void;
  /** Plain text of the chat message immediately following this block's own message, if
   * any — see the contract comment above for what this means and where it comes from. */
  answeredWith?: string;
}

function parseOptionsBlock(json: string): OptionsBlock | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.question !== "string" || !parsed.question.trim()) return null;
    if (!Array.isArray(parsed.options) || parsed.options.length === 0 || parsed.options.length > 4) return null;

    const options: Option[] = [];
    for (const raw of parsed.options) {
      if (!raw || typeof raw.label !== "string" || !raw.label.trim()) return null;
      if (raw.description !== undefined && typeof raw.description !== "string") return null;
      if (raw.recommended !== undefined && typeof raw.recommended !== "boolean") return null;
      options.push({ label: raw.label, description: raw.description, recommended: raw.recommended === true });
    }
    if (parsed.multiSelect !== undefined && typeof parsed.multiSelect !== "boolean") return null;

    return { question: parsed.question, options, multiSelect: parsed.multiSelect === true };
  } catch {
    return null;
  }
}

/** Which option label(s), if any, the follow-up message's plain text identifies —
 * exact match only (single label, or a ", "-joined list matching multi-select's own
 * send format). A non-matching or unparseable answer just yields an empty set; the
 * card still locks read-only either way (see `answered` below). */
function parsePickedLabels(answeredWith: string | undefined, options: Option[]): Set<string> {
  if (!answeredWith) return new Set();
  const known = new Set(options.map((o) => o.label));
  const parts = answeredWith
    .split(",")
    .map((p) => p.trim())
    .filter((p) => known.has(p));
  return new Set(parts);
}

function OptionsPicker({ json, onSend, answeredWith }: OptionsPickerProps) {
  const block = parseOptionsBlock(json);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  if (!block) {
    return <div className="options-picker options-picker--error">Couldn't render this question.</div>;
  }

  const answered = answeredWith !== undefined;
  const pickedLabels = parsePickedLabels(answeredWith, block.options);

  const toggle = (label: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const confirmMultiSelect = () => {
    const picked = block.options.map((o) => o.label).filter((label) => checked.has(label));
    if (picked.length === 0) return;
    onSend(picked.join(", "));
  };

  return (
    <div className={`options-picker${answered ? " options-picker--answered" : ""}`}>
      <div className="options-picker__question">{block.question}</div>
      <div className="options-picker__list">
        {block.options.map((option) => {
          const isPicked = pickedLabels.has(option.label);
          const isChecked = checked.has(option.label);
          const cardClass = [
            "options-picker__option",
            option.recommended ? "options-picker__option--recommended" : "",
            isPicked ? "options-picker__option--picked" : "",
          ]
            .filter(Boolean)
            .join(" ");

          const cardBody = (
            <>
              <div className="options-picker__option-head">
                {block.multiSelect && !answered && (
                  <span
                    className={`options-picker__checkbox${isChecked ? " options-picker__checkbox--checked" : ""}`}
                    aria-hidden="true"
                  />
                )}
                <span className="options-picker__option-label">{option.label}</span>
                {option.recommended && <span className="options-picker__badge">Recommended</span>}
                {isPicked && (
                  <span className="options-picker__picked-mark" aria-hidden="true">
                    ✓
                  </span>
                )}
              </div>
              {option.description && (
                <div className="options-picker__option-description">{option.description}</div>
              )}
            </>
          );

          if (answered) {
            return (
              <div key={option.label} className={cardClass} aria-disabled="true">
                {cardBody}
              </div>
            );
          }

          if (block.multiSelect) {
            return (
              <button
                key={option.label}
                type="button"
                role="checkbox"
                aria-checked={isChecked}
                className={cardClass}
                onClick={() => toggle(option.label)}
              >
                {cardBody}
              </button>
            );
          }

          return (
            <button key={option.label} type="button" className={cardClass} onClick={() => onSend(option.label)}>
              {cardBody}
            </button>
          );
        })}
      </div>
      {block.multiSelect && !answered && (
        <button
          type="button"
          className="btn-primary options-picker__confirm"
          onClick={confirmMultiSelect}
          disabled={checked.size === 0}
        >
          Confirm
        </button>
      )}
    </div>
  );
}

export default OptionsPicker;
