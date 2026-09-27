/** The "[Study item: kind|id|title|detail]" marker the backend's study tools end their result
 * with (see services/api/app/services/study_links.py) — turned into a real, clickable card under
 * Newton's reply, exactly like an "[Attached document: id|filename]" marker becomes a document
 * card. Clicking one opens what it names: the practice exam itself, the flashcard deck, or the
 * study plan. */
export type StudyItemKind = "exam" | "flashcards" | "plan";

export interface StudyItemRef {
  kind: StudyItemKind;
  /** the exam id for "exam"; the source document's id for the others, or null (the marker's "-") */
  id: string | null;
  title: string;
  /** a short count, e.g. "15 questions" */
  detail: string;
}

const STUDY_ITEM_RE = /\[Study item: (exam|flashcards|plan)\|([^|\]]*)\|([^|\]]*)\|([^\]]*)\]/g;

export function extractStudyItems(content: string): { text: string; items: StudyItemRef[] } {
  const items: StudyItemRef[] = [];
  const text = content
    .replace(STUDY_ITEM_RE, (_match, kind: StudyItemKind, id: string, title: string, detail: string) => {
      const cleanId = id.trim();
      items.push({ kind, id: cleanId && cleanId !== "-" ? cleanId : null, title: title.trim(), detail: detail.trim() });
      return "";
    })
    .trim();
  return { text, items };
}

/** The suggested-action panel a study item makes redundant (the reply already carries a card that
 * opens the same thing, so a second "Open Flashcards" button would just repeat it). */
export const STUDY_KIND_PANEL: Record<StudyItemKind, string> = {
  exam: "practice_exams",
  flashcards: "flashcards",
  plan: "study_plan",
};
