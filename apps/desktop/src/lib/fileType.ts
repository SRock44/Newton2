/** Short type badge for a document row/card — PDF is view-only elsewhere in this app,
 * worth surfacing at a glance before a student even opens it. Shared by
 * DocumentsPanel.tsx's file list and HomeView.tsx's "Recent documents & notes" widget
 * (via RecentItemCard.tsx) so both ever agree on what a given document "is". */
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Whether a document's ORIGINAL bytes can be shown in the embedded viewer — true only
 * for real PDFs. The backend marks every non-text document as non-editable (see
 * is_editable), but "not editable" and "renderable in an <iframe>" are different
 * questions: a .pptx/.docx is binary Office XML the webview can't display at all, so
 * those fall back to the extracted text the content endpoint already returns, which is
 * the same text Newton's RAG retrieval sees. */
export function isPreviewableAsPdf(doc: { filename: string; mime_type: string | null }): boolean {
  return doc.filename.toLowerCase().endsWith(".pdf") || doc.mime_type === "application/pdf";
}

export function documentTypeLabel(doc: { filename: string; mime_type: string | null }): string {
  const name = doc.filename.toLowerCase();
  if (name.endsWith(".pdf") || doc.mime_type === "application/pdf") return "PDF";
  // Lecture slides and Word documents — checked before the text cases below, and given
  // their own badges rather than falling through to "DOC". That fallback is the generic
  // "some other document" label (it's what a .tex research-paper source gets, for
  // instance), so letting a real .docx land on it would be actively misleading: a
  // student would read "DOC" as "this is the legacy .doc format", and a .pptx has no
  // business wearing a document badge at all.
  if (name.endsWith(".pptx") || doc.mime_type === PPTX_MIME) return "PPTX";
  if (name.endsWith(".docx") || doc.mime_type === DOCX_MIME) return "DOCX";
  if (name.endsWith(".md") || name.endsWith(".markdown") || doc.mime_type === "text/markdown") return "MD";
  if (name.endsWith(".txt") || doc.mime_type === "text/plain") return "TXT";
  return "DOC";
}
