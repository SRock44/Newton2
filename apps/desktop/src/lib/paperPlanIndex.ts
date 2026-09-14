import type { ChatMessage } from "../types";

const PAPER_PLAN_FENCE = "```paper-plan";

/** Finds the index of the most recent message containing a ```paper-plan fenced block
 * (scanning from the newest message backward) — same "just scan the raw message text"
 * approach as notepadContent.ts's latestMathStepsJson. Used by ChatPane to decide which
 * single paper-plan card in the visible history, if any, should still show its Approve
 * & Write / Request Changes buttons: only the most recent one does — an earlier plan,
 * superseded by a newer one, always renders read-only, regardless of whether (or how)
 * the student actually responded to it. Returns -1 if no message contains one. */
export function latestPaperPlanMessageIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.content?.includes(PAPER_PLAN_FENCE)) return i;
  }
  return -1;
}
