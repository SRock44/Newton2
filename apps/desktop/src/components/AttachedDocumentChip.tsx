interface AttachedDocumentChipProps {
  documentId: string;
  filename: string;
  onOpen: (documentId: string, filename: string) => void;
}

/** Renders a "[Attached document: <id>|<filename>]" marker (see MessageBubble.tsx's
 * ATTACHED_DOCUMENT_RE) as a real, clickable attachment chip — the document version of
 * AttachedImage.tsx's thumbnail. Unlike an image, a document attachment doesn't need a
 * fetch to render: the marker already carries the filename, so this is just an icon +
 * name + click target that opens it alongside this chat (see App.tsx's
 * handleOpenDocumentInChat / DocumentViewerPanel). `filename` rides along on the click
 * so that panel has a real title to show before its own content fetch resolves. */
function AttachedDocumentChip({ documentId, filename, onOpen }: AttachedDocumentChipProps) {
  return (
    <button
      type="button"
      className="attached-document-chip"
      onClick={() => onOpen(documentId, filename)}
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
