import { documentTypeLabel } from "../lib/fileType";

interface AttachedDocumentChipProps {
  documentId: string;
  filename: string;
  onOpen: (documentId: string, filename: string) => void;
  /** True while this exact document is the one currently open in the split panel — see
   * App.tsx's chatDocumentPanel. Only cosmetic (an active outline/fill); clicking an
   * already-open card still calls onOpen, which is what actually toggles it closed. */
  active?: boolean;
}

/** Renders a "[Attached document: <id>|<filename>]" marker (see MessageBubble.tsx's
 * ATTACHED_DOCUMENT_RE) as a real, clickable document card — deliberately closer to
 * Claude.ai's own file cards (a colored type badge, the name, the type, a real rounded
 * button) than a plain inline chip, since this is exactly what it is: a document Newton
 * just produced, or one the student attached, either way meant to be opened right here.
 * Clicking it opens it split with this chat (App.tsx's handleOpenDocumentInChat), and
 * clicking the ALREADY-open one again closes it — that toggle lives in App.tsx, not
 * here; this component only reflects the current state via `active`. */
function AttachedDocumentChip({ documentId, filename, onOpen, active }: AttachedDocumentChipProps) {
  const typeLabel = documentTypeLabel({ filename, mime_type: null });
  return (
    <button
      type="button"
      className={`attached-document-chip${active ? " attached-document-chip--active" : ""}`}
      onClick={() => onOpen(documentId, filename)}
      aria-pressed={Boolean(active)}
      title={active ? `Close ${filename}` : `Open ${filename}`}
    >
      <span className="attached-document-chip-badge" aria-hidden="true">
        {typeLabel}
      </span>
      <span className="attached-document-chip-body">
        <span className="attached-document-chip-name">{filename}</span>
        <span className="attached-document-chip-type">{typeLabel} — click to {active ? "close" : "open"}</span>
      </span>
    </button>
  );
}

export default AttachedDocumentChip;
