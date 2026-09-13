import type { ChatMessage } from "../types";

const MATH_STEPS_FENCE = /```math-steps\s*\n([\s\S]*?)```/g;

/** Finds the most recent ```math-steps fenced block across all messages (scanning from
 * the newest message backward, and within a message from its last such block) — this is
 * what "the notepad window mirrors the main window's current derivation" means in
 * practice, since there's no separate notepad state to track, just whatever step-by-step
 * math last appeared in chat. Returns the raw JSON string (as MathSteps expects), or null
 * if nothing has been shown yet. */
export function latestMathStepsJson(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i]?.content;
    if (!content || !content.includes("```math-steps")) continue;

    let match: RegExpExecArray | null;
    let last: string | null = null;
    MATH_STEPS_FENCE.lastIndex = 0;
    while ((match = MATH_STEPS_FENCE.exec(content)) !== null) {
      last = match[1].trim();
    }
    if (last) return last;
  }
  return null;
}
