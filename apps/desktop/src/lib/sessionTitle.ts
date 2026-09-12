import type { ChatSession } from "../types";

const MAX_TITLE_LENGTH = 42;

/**
 * Sessions never come back with a server-set title today, so we derive one
 * client-side: prefer a snippet of the first user message we've seen for
 * this session, otherwise fall back to "New chat" plus a formatted date.
 */
export function sessionDisplayTitle(session: ChatSession, firstUserMessage?: string): string {
  if (session.title && session.title.trim().length > 0) {
    return session.title;
  }
  if (firstUserMessage && firstUserMessage.trim().length > 0) {
    const cleaned = firstUserMessage.trim().replace(/\s+/g, " ");
    return cleaned.length > MAX_TITLE_LENGTH ? `${cleaned.slice(0, MAX_TITLE_LENGTH).trim()}…` : cleaned;
  }
  const date = new Date(session.created_at);
  if (Number.isNaN(date.getTime())) return "New chat";
  const formatted = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `New chat · ${formatted}`;
}
