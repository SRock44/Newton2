import type { NoteAnnotateAction } from "../types";

/** What a highlighted passage in the document viewer is currently being used for — shown as
 * an indicator above the chatbox (Composer's banner), so a student can SEE that clicking
 * Explain / Define / Summarize / Ask Newton registered and what it's acting on, the same
 * idea as the "Requesting changes to <plan>" banner. */
export type SelectionActivityAction = "ask" | NoteAnnotateAction;

export interface SelectionActivity {
  action: SelectionActivityAction;
  /** A few-word AI summary of what was highlighted (see the backend's
   * POST /documents/{id}/selection-topic), already display-ready. Null until it arrives —
   * the label reads "your selection" meanwhile. */
  topic: string | null;
  /** True while Newton's explanation / definition / summary is still being generated.
   * Always false for "ask", which just puts the quote in the composer. */
  working: boolean;
}

const WORKING: Record<NoteAnnotateAction, string> = {
  explain: "Explaining",
  define: "Defining",
  summarize: "Summarizing",
};
const DONE: Record<NoteAnnotateAction, string> = {
  explain: "Newton explained",
  define: "Newton defined",
  summarize: "Newton summarized",
};

/** The banner's text: "Asking Newton about <x>", "Defining <x>…" while it runs, and
 * "Newton defined <x>" once the result is up. */
export function selectionActivityLabel(activity: SelectionActivity): string {
  const subject = activity.topic ?? "your selection";
  if (activity.action === "ask") {
    return `Asking Newton about ${subject}${activity.topic ? "" : "…"}`;
  }
  return activity.working ? `${WORKING[activity.action]} ${subject}…` : `${DONE[activity.action]} ${subject}`;
}

const FALLBACK_WORDS = 6;

/** What to show when the AI label can't be had (offline, timed out, empty): the first few
 * words of the highlight itself, quoted so it reads as a snippet rather than a topic. */
export function fallbackTopic(selected: string): string {
  const words = selected.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "your selection";
  const head = words.slice(0, FALLBACK_WORDS).join(" ");
  return `“${head}${words.length > FALLBACK_WORDS ? "…" : ""}”`;
}
