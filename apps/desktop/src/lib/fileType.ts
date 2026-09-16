/** Short type badge for a document row/card — PDF is view-only elsewhere in this app,
 * worth surfacing at a glance before a student even opens it. Shared by
 * DocumentsPanel.tsx's file list and HomeView.tsx's "Recent documents & notes" widget
 * (via RecentItemCard.tsx) so both ever agree on what a given document "is". */
export function documentTypeLabel(doc: { filename: string; mime_type: string | null }): string {
  const name = doc.filename.toLowerCase();
  if (name.endsWith(".pdf") || doc.mime_type === "application/pdf") return "PDF";
  if (name.endsWith(".md") || name.endsWith(".markdown") || doc.mime_type === "text/markdown") return "MD";
  if (name.endsWith(".txt") || doc.mime_type === "text/plain") return "TXT";
  return "DOC";
}
