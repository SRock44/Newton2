import { useEffect, useState } from "react";
import { ApiError, deleteStudyPlanItem, listStudyPlan } from "../api";
import type { StudyPlanItem } from "../types";

interface StudyPlanPanelProps {
  token: string;
  onClose: () => void;
}

function formatDueDate(item: StudyPlanItem): string {
  if (item.due_date) {
    const date = new Date(`${item.due_date}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
  }
  return item.due_date_text || "No specific date";
}

/** Lists what Newton has extracted from uploaded syllabi (see the Documents panel's
 * "Study plan" button on each document). Read-only aside from delete — items come
 * from generation, not manual entry, at least for now. */
function StudyPlanPanel({ token, onClose }: StudyPlanPanelProps) {
  const [items, setItems] = useState<StudyPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listStudyPlan(token)
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load your study plan.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleDelete(id: string) {
    try {
      await deleteStudyPlanItem(token, id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove this item.");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Study plan</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="modal-subtitle">
          Extracted from your uploaded syllabi — open Documents and use "Study plan" on one to
          add more.
        </p>

        {error && <div className="chat-pane-banner chat-pane-banner--error">{error}</div>}

        {loading ? (
          <p className="session-list-empty">Loading…</p>
        ) : items.length === 0 ? (
          <p className="session-list-empty">
            No study plan items yet — upload a syllabus in Documents and generate one.
          </p>
        ) : (
          <ul className="document-list">
            {items.map((item) => (
              <li key={item.id} className="document-item document-item--stacked">
                <div className="document-item-row">
                  <div>
                    <div className="document-item-name">{item.title}</div>
                    <div className="document-item-date">{formatDueDate(item)}</div>
                  </div>
                  <button
                    type="button"
                    className="sidebar-signout"
                    onClick={() => handleDelete(item.id)}
                    aria-label={`Remove ${item.title}`}
                  >
                    Remove
                  </button>
                </div>
                {item.notes && <div className="document-item-plan-status">{item.notes}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default StudyPlanPanel;
