interface AttachedDocumentChipProps {
  documentId: string;
  filename: string;
  onOpen: (documentId: string) => void;
}

/** Renders a "[Attached document: <id>|<filename>]" marker (see MessageBubble.tsx's
 * ATTACHED_DOCUMENT_RE) as a real, clickable attachment chip — the document version of
 * AttachedImage.tsx's thumbnail. Unlike an image, a document attachment doesn't need a
 * fetch to render: the marker already carries the filename, so this is just an icon +
 * name + click target that jumps the student to that document on the Documents page
 * (see App.tsx's handleOpenDocument / mainView). */
function AttachedDocumentChip({ documentId, filename, onOpen }: AttachedDocumentChipProps) {
  return (
    <button
      type="button"
      className="attached-document-chip"
      onClick={() => onOpen(documentId)}
      title={`Open ${filename}`}
    >
      <span className="attached-document-chip-icon" aria-hidden="true">
        📄
      </span>
      <span className="attached-document-chip-name">{filename}</span>
    </button>
  );
}

export default AttachedDocumentChip;
