"""The "[Study item: kind|id|title|detail]" marker the study tools end their result with, which the
desktop app renders as a real, clickable card under Newton's reply -- the same idea (and the same
"relay it verbatim" contract) as write_research_paper's "[Attached document: id|filename]" markers.
Clicking a card opens what it names: a practice exam straight into that exam, the flashcard deck,
or the study plan.

  kind    "exam" | "flashcards" | "plan"
  id      the exam id for "exam"; the source document's id for the others, or "-" when there is none
  title   what to call it (the source document's filename, or the topic)
  detail  a short count, e.g. "15 questions", "15 cards", "7 items"
"""
import uuid

STUDY_KINDS = ("exam", "flashcards", "plan")


def _clean(text: str) -> str:
    # the marker is pipe-delimited and bracket-terminated
    return " ".join(str(text).replace("|", "/").replace("[", "(").replace("]", ")").split())


def study_link(kind: str, item_id: uuid.UUID | str | None, title: str, detail: str) -> str:
    if kind not in STUDY_KINDS:
        raise ValueError(f"unknown study item kind: {kind!r}")
    return f"[Study item: {kind}|{item_id if item_id else '-'}|{_clean(title)}|{_clean(detail)}]"
