const SNIPPET_MAX_LENGTH = 140;

/** A short, single-line-friendly excerpt of a document/note's real content — shared by
 * HomeView.tsx's "Recent documents & notes" widget and DocumentsPanel.tsx's grid view,
 * since both feed the exact same RecentItemCard "card" variant thumbnail. */
export function toSnippet(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > SNIPPET_MAX_LENGTH ? `${cleaned.slice(0, SNIPPET_MAX_LENGTH).trim()}…` : cleaned;
}
