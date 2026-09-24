/**
 * Fenced-block contract — a proposed Artifact for the student to confirm BEFORE the
 * expensive build runs. Directly modeled on PaperPlanCard.tsx (the app's existing
 * plan → approve → expensive-tool flow), and it reuses the exact same `onSend` /
 * `onFocusComposer` plumbing rather than introducing any new props or WebSocket
 * protocol:
 *
 * ```artifact-plan
 * {
 *   "kind": "diagram" | "chart" | "slideshow" | "interactive" | "quiz",
 *   "title": "Short title",
 *   "summary": "1-2 sentences on what it will show and what the student can do with it"
 * }
 * ```
 *
 * WHY THIS CARD EXISTS AT ALL: an artifact is the most expensive thing a student can
 * ask Newton to do — a persona call plus a full multi-step agentic coding run, minutes
 * of wall clock and several times the token cost of any other reply. The app's
 * established convention for that is not to hide it: the Documents panel tells free-plan
 * students exactly what they get per generation, before they click, in plain
 * non-punitive language. This card carries the same kind of note, in the same register,
 * for the same reason — so "this one is expensive" is something the student knows going
 * in, not something they infer afterwards from a slow reply.
 *
 * ── "Build it" is one-shot, and that is load-bearing ────────────────────────────────
 * A build takes minutes and costs real money, so the button must not stay live while one
 * is already running. It locks on the first click, via two independent signals, because
 * either one alone leaves a real hole:
 *
 *   - `sent` (local state) covers the click that JUST happened. The student's approval
 *     message takes a moment to round-trip, and the whole build takes minutes; without
 *     this the button sits there enabled and inviting for the entire run, and a second
 *     click starts a SECOND paid build. (Found by clicking it twice in the real app.)
 *   - `answeredWith` (the chat message following this one — the same `nextMessageContent`
 *     plumbing OptionsPicker/StepCheck/Checkpoint already use) covers everything local
 *     state cannot: reopening the conversation later, a remount, another device. Local
 *     state resets on every one of those; the conversation itself does not.
 *
 * Unlike PaperPlanCard this has no separate "a newer plan replaced this one" staleness
 * state. Once a card has been acted on it locks regardless, which subsumes the case that
 * rule existed for, without a second index (lib/paperPlanIndex.ts) or extra prop
 * threading.
 */

import { useState } from "react";

interface ArtifactPlanBlock {
  kind: string;
  title: string;
  summary: string;
}

/** One entry per kind in create_artifact.py's ARTIFACT_KINDS, matching ArtifactBlock's
 * labels exactly — the badge a student approves here and the badge on the finished
 * artifact must read the same, or the plan looks like it built something else. */
const KIND_LABELS: Record<string, string> = {
  diagram: "Diagram",
  chart: "Chart",
  slideshow: "Slideshow",
  interactive: "Interactive",
  quiz: "Quiz game",
};

/** What "Build it" sends on the student's behalf — a plain chat message, exactly like
 * PaperPlanCard's APPROVE_MESSAGE. The backend/model layer decides what that means. */
export const BUILD_MESSAGE = "Yes — go ahead and build that artifact.";

/** The cost note, kept as an exported constant so the test asserts on the real string
 * the student sees. Deliberately concrete (what it does, roughly how long, that it's
 * Pro) and deliberately not scolding — the same informative tone as the Documents
 * panel's "Free plan generates up to N items per request" note, which is this app's
 * established wording for "here's what this costs you, decide freely". */
export const COST_NOTE =
  "Heads up: this runs a real coding agent to write it, so it takes a minute or two and " +
  "costs a lot more than a normal reply — more than generating a paper or a slide deck. " +
  "It's a Pro feature and it draws on your credit. Everything else stays as it is.";

export function parseArtifactPlan(json: string): ArtifactPlanBlock | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.kind !== "string" || !parsed.kind.trim()) return null;
    if (typeof parsed.title !== "string" || !parsed.title.trim()) return null;
    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) return null;
    return { kind: parsed.kind, title: parsed.title, summary: parsed.summary };
  } catch {
    return null;
  }
}

/** Shown in place of the actions once this card has been acted on — a build is already
 * running (or has already run), and the honest thing is to say so rather than leave a
 * dead-looking button. */
export const BUILDING_NOTE = "Building this artifact — it'll appear here when it's ready.";

interface ArtifactPlanCardProps {
  json: string;
  /** Sends the fixed "Build it" confirmation message. */
  onApprove: (text: string) => void;
  /** Focuses the composer for "Change it" — sends nothing itself. Called with this
   * plan's title, so the composer can show which plan changes are being requested
   * for (same convention as PaperPlanCard.tsx). */
  onRequestChanges: (title: string) => void;
  /** The plain text of the chat message right after this one, if any — the same prop
   * OptionsPicker/StepCheck/Checkpoint use. Its mere existence means this card was
   * already acted on, so the actions render locked even after a remount or a reload.
   * See the contract comment above. */
  answeredWith?: string;
}

function ArtifactPlanCard({ json, onApprove, onRequestChanges, answeredWith }: ArtifactPlanCardProps) {
  const [sent, setSent] = useState(false);
  const plan = parseArtifactPlan(json);

  if (!plan) {
    return <div className="artifact-plan-card artifact-plan-card--error">Couldn't render this plan.</div>;
  }

  const locked = sent || answeredWith !== undefined;

  function handleBuild() {
    // Guard the handler too, not just the disabled attribute: a double-click can land
    // two events before React re-renders, and each one is a real, paid build.
    if (locked) return;
    setSent(true);
    onApprove(BUILD_MESSAGE);
  }

  return (
    <div className="artifact-plan-card">
      <div className="artifact-plan-card__header">
        <span className="artifact-plan-card__kind-badge">{KIND_LABELS[plan.kind] ?? plan.kind}</span>
        <h3 className="artifact-plan-card__title">{plan.title}</h3>
      </div>
      <p className="artifact-plan-card__summary">{plan.summary}</p>
      <p className="artifact-plan-card__cost-note">{COST_NOTE}</p>
      {locked ? (
        <div className="artifact-plan-card__locked-note">{BUILDING_NOTE}</div>
      ) : (
        <div className="artifact-plan-card__actions">
          <button type="button" className="btn-primary" onClick={handleBuild}>
            Build it
          </button>
          <button type="button" className="btn-secondary" onClick={() => onRequestChanges(plan.title)}>
            Change it
          </button>
        </div>
      )}
    </div>
  );
}

export default ArtifactPlanCard;
