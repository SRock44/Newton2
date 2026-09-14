/**
 * Fenced-block contract — a research-paper plan for the student to review, modeled on
 * Claude Code's own plan-mode review step:
 *
 * ```paper-plan
 * {
 *   "title": "Working title",
 *   "style": "ieee",
 *   "abstract_sketch": "1-3 sentence summary of the intended argument/contribution.",
 *   "sections": [
 *     { "heading": "Introduction", "summary": "What this section will cover." },
 *     { "heading": "Related Work", "summary": "..." }
 *   ],
 *   "sources_needed": ["A short note on what research/sources are still needed, if any"]
 * }
 * ```
 *
 * - `title`, `style`, and `abstract_sketch`: required non-empty strings. `style` is a
 *   short free-form label (e.g. "ieee", "apa7") — rendered verbatim, just upper-cased,
 *   as a badge; this component doesn't validate it against a fixed set of styles.
 * - `sections`: required, at least one `{ heading, summary }` pair, rendered as a
 *   numbered outline in the given order. `summary` may be an empty string; `heading`
 *   may not.
 * - `sources_needed`: optional array of strings. Omit it, or send an empty array, when
 *   nothing further is needed — the section is only shown when it's non-empty.
 *
 * Two buttons below the plan are pure chat-message shortcuts, not real approval logic:
 * "Approve & Write" sends a fixed confirmation sentence; "Request Changes" sends
 * nothing and just focuses the composer so the student types their own tweaks. What
 * either message actually causes next (which tool gets called, what "approved" means)
 * is entirely up to the backend orchestration/model layer — this component has no
 * opinion on it and does not try to detect approval from later chat content.
 *
 * Only the single most recent paper-plan block in the visible conversation should ever
 * show these buttons as clickable — an earlier plan, superseded by a newer one, always
 * renders read-only. That decision is made one level up by scanning the full message
 * list for the last message containing a ```paper-plan fence (see
 * lib/paperPlanIndex.ts + ChatPane.tsx) and passed in here as the `interactive` prop;
 * this component itself has no access to (and makes no assumption about) any other
 * plan blocks that may exist elsewhere in the conversation.
 */
interface PaperPlanSection {
  heading: string;
  summary: string;
}

interface PaperPlanBlock {
  title: string;
  style: string;
  abstract_sketch: string;
  sections: PaperPlanSection[];
  sources_needed?: string[];
}

interface PaperPlanCardProps {
  json: string;
  /** Sends the fixed "Approve & Write" confirmation message. */
  onApprove: (text: string) => void;
  /** Focuses the composer for "Request Changes" — sends nothing itself. */
  onRequestChanges: () => void;
  /** Whether this is the most recent paper-plan block in the visible conversation (see
   * the contract comment above). Only then do the action buttons render as clickable. */
  interactive: boolean;
}

export const APPROVE_MESSAGE = "Looks good — go ahead and write it.";

function parsePaperPlan(json: string): PaperPlanBlock | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.title !== "string" || !parsed.title.trim()) return null;
    if (typeof parsed.style !== "string" || !parsed.style.trim()) return null;
    if (typeof parsed.abstract_sketch !== "string" || !parsed.abstract_sketch.trim()) return null;
    if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) return null;

    const sections: PaperPlanSection[] = [];
    for (const raw of parsed.sections) {
      if (!raw || typeof raw.heading !== "string" || !raw.heading.trim()) return null;
      if (typeof raw.summary !== "string") return null;
      sections.push({ heading: raw.heading, summary: raw.summary });
    }

    let sourcesNeeded: string[] | undefined;
    if (parsed.sources_needed !== undefined) {
      if (
        !Array.isArray(parsed.sources_needed) ||
        !parsed.sources_needed.every((s: unknown) => typeof s === "string")
      ) {
        return null;
      }
      sourcesNeeded = parsed.sources_needed;
    }

    return {
      title: parsed.title,
      style: parsed.style,
      abstract_sketch: parsed.abstract_sketch,
      sections,
      sources_needed: sourcesNeeded,
    };
  } catch {
    return null;
  }
}

function PaperPlanCard({ json, onApprove, onRequestChanges, interactive }: PaperPlanCardProps) {
  const plan = parsePaperPlan(json);

  if (!plan) {
    return <div className="paper-plan-card paper-plan-card--error">Couldn't render this plan.</div>;
  }

  return (
    <div className="paper-plan-card">
      <div className="paper-plan-card__header">
        <span className="paper-plan-card__style-badge">{plan.style.toUpperCase()}</span>
        <h3 className="paper-plan-card__title">{plan.title}</h3>
      </div>
      <p className="paper-plan-card__abstract">{plan.abstract_sketch}</p>
      <ol className="paper-plan-card__sections">
        {plan.sections.map((section, i) => (
          <li key={i} className="paper-plan-card__section">
            <div className="paper-plan-card__section-heading">{section.heading}</div>
            {section.summary && <div className="paper-plan-card__section-summary">{section.summary}</div>}
          </li>
        ))}
      </ol>
      {plan.sources_needed && plan.sources_needed.length > 0 && (
        <div className="paper-plan-card__sources">
          <div className="eyebrow">Sources still needed</div>
          <ul>
            {plan.sources_needed.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {interactive ? (
        <div className="paper-plan-card__actions">
          <button type="button" className="btn-primary" onClick={() => onApprove(APPROVE_MESSAGE)}>
            Approve &amp; Write
          </button>
          <button type="button" className="btn-secondary" onClick={onRequestChanges}>
            Request Changes
          </button>
        </div>
      ) : (
        <div className="paper-plan-card__stale-note">A newer plan has replaced this one.</div>
      )}
    </div>
  );
}

export default PaperPlanCard;
