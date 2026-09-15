import type { ChatMessage } from "../types";

// The interactive fenced-block types that send the student's response back into the
// conversation as a real chat message (see OptionsPicker/PaperPlanCard/StepCheck/
// Checkpoint's own contract comments and CodeBlock.tsx's dispatch) so the model can see
// and react to it — but each of those blocks ALSO renders that same answer inline,
// read-only, once it's landed (their `answeredWith` prop, always just
// `messages[index + 1]?.content` — see ChatPane.tsx). Left alone, that means the exact
// same text shows up twice: once inside the card, once again as its own ordinary chat
// bubble right below it.
const INTERACTIVE_BLOCK_FENCES = ["```options", "```paper-plan", "```step-check", "```checkpoint"];

function endsWithInteractiveBlock(content: string | undefined): boolean {
  if (!content) return false;
  return INTERACTIVE_BLOCK_FENCES.some((fence) => content.includes(fence));
}

/** True when `messages[index]` is the student's own message answering an interactive
 * block (options/paper-plan/step-check/checkpoint) in the immediately preceding
 * assistant message — i.e. exactly the message a `MessageBubble` upstream is already
 * showing, read-only, inside that block's own card. The message still gets sent for
 * real (the model needs it in history to respond) and still counts as `nextMessageContent`
 * for that block's `answeredWith` — this only says whether ChatPane should also render
 * it as its own separate bubble, which would just be a redundant echo of what the card
 * already shows. */
export function isAnswerToInteractiveBlock(messages: ChatMessage[], index: number): boolean {
  const message = messages[index];
  if (!message || message.role !== "user") return false;
  const previous = messages[index - 1];
  if (!previous || previous.role !== "assistant") return false;
  return endsWithInteractiveBlock(previous.content);
}
