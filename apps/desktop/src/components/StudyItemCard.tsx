import type { StudyItemKind } from "../lib/studyLinks";

const KIND_LABEL: Record<StudyItemKind, string> = {
  exam: "Practice exam",
  flashcards: "Flashcards",
  plan: "Study plan",
};
const KIND_BADGE: Record<StudyItemKind, string> = {
  exam: "EXAM",
  flashcards: "CARDS",
  plan: "PLAN",
};

interface StudyItemCardProps {
  kind: StudyItemKind;
  title: string;
  detail: string;
  onOpen: () => void;
}

/** A study plan / flashcard set / practice exam Newton just generated, as a real clickable card
 * under its reply — the same rounded-card look as AttachedDocumentChip (it deliberately reuses its
 * classes), since it is the same idea: something Newton made, meant to be opened right there. */
function StudyItemCard({ kind, title, detail, onOpen }: StudyItemCardProps) {
  return (
    <button
      type="button"
      className={`attached-document-chip study-item-card study-item-card--${kind}`}
      onClick={onOpen}
      title={`Open ${KIND_LABEL[kind].toLowerCase()}: ${title}`}
    >
      <span className="attached-document-chip-badge" aria-hidden="true">
        {KIND_BADGE[kind]}
      </span>
      <span className="attached-document-chip-body">
        <span className="attached-document-chip-name">{title}</span>
        <span className="attached-document-chip-type">
          {KIND_LABEL[kind]}
          {detail ? ` · ${detail}` : ""} — click to open
        </span>
      </span>
    </button>
  );
}

export default StudyItemCard;
