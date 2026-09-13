import { useEffect, useState } from "react";
import {
  ApiError,
  deletePracticeExam,
  getPracticeExam,
  listPracticeExams,
  submitPracticeExam,
} from "../api";
import type { PracticeExamDetail, PracticeExamSummary } from "../types";

interface PracticeExamsPanelProps {
  token: string;
  onClose: () => void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function scoreLabel(exam: PracticeExamSummary): string {
  if (exam.score === null) return "Not taken yet";
  return `${Math.round(exam.score * 100)}%`;
}

/** List every generated exam (score if taken); open one to take it (all questions on
 * one screen, pick a choice per question, submit) or review it (score + per-question
 * correct/incorrect + explanation, once completed). Generation happens from the
 * Documents panel, matching Flashcards/Study Plan. */
function PracticeExamsPanel({ token, onClose }: PracticeExamsPanelProps) {
  const [exams, setExams] = useState<PracticeExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [active, setActive] = useState<PracticeExamDetail | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setExams(await listPracticeExams(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your practice exams.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openExam(id: string) {
    setActiveLoading(true);
    setError(null);
    setAnswers({});
    try {
      setActive(await getPracticeExam(token, id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this practice exam.");
    } finally {
      setActiveLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePracticeExam(token, id);
      setExams((prev) => prev.filter((e) => e.id !== id));
      if (active?.id === id) setActive(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove this practice exam.");
    }
  }

  async function handleSubmit() {
    if (!active || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitPracticeExam(token, active.id, answers);
      setActive(result);
      setExams((prev) => prev.map((e) => (e.id === result.id ? { ...e, score: result.score, completed_at: result.completed_at } : e)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit this exam.");
    } finally {
      setSubmitting(false);
    }
  }

  const isComplete = active?.completed_at != null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{active ? active.title : "Practice exams"}</h2>
          {active ? (
            <button type="button" className="modal-close" onClick={() => setActive(null)} aria-label="Back to list">
              ‹
            </button>
          ) : (
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>

        {error && <div className="banner banner--error">{error}</div>}

        {!active ? (
          loading ? (
            <p className="empty-state-text">Loading…</p>
          ) : exams.length === 0 ? (
            <p className="empty-state-text">
              No practice exams yet — generate one from a document in Documents.
            </p>
          ) : (
            <ul className="item-list">
              {exams.map((exam) => (
                <li key={exam.id} className="item-row item-row--stacked">
                  <div className="item-row-main">
                    <button type="button" className="exam-list-title" onClick={() => openExam(exam.id)}>
                      <div className="item-title">{exam.title}</div>
                      <div className="item-meta">
                        {exam.difficulty} · {scoreLabel(exam)} · {formatDate(exam.created_at)}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary-sm btn-secondary-sm--danger"
                      onClick={() => handleDelete(exam.id)}
                      aria-label={`Delete exam: ${exam.title}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : activeLoading ? (
          <p className="empty-state-text">Loading…</p>
        ) : (
          <div className="exam-taking">
            {isComplete && (
              <div
                className={`exam-score-banner ${
                  (active.score ?? 0) >= 0.7 ? "exam-score-banner--good" : "exam-score-banner--needs-review"
                }`}
              >
                Score: {Math.round((active.score ?? 0) * 100)}%
              </div>
            )}
            {active.questions.map((q, i) => (
              <div key={q.id} className="exam-question">
                <div className="exam-question-text">
                  {i + 1}. {q.question}
                </div>
                <div className="exam-choices">
                  {q.choices.map((choice, choiceIndex) => {
                    const chosen = answers[q.id] === choiceIndex || q.student_answer_index === choiceIndex;
                    let className = "exam-choice";
                    if (isComplete) {
                      if (choiceIndex === q.correct_index) className += " exam-choice--correct";
                      else if (chosen && !q.is_correct) className += " exam-choice--wrong";
                    } else if (chosen) {
                      className += " exam-choice--selected";
                    }
                    return (
                      <button
                        key={choiceIndex}
                        type="button"
                        className={className}
                        disabled={isComplete}
                        onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: choiceIndex }))}
                      >
                        {choice}
                      </button>
                    );
                  })}
                </div>
                {isComplete && q.explanation && (
                  <div className="exam-explanation">{q.explanation}</div>
                )}
              </div>
            ))}

            {!isComplete && (
              <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit answers"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PracticeExamsPanel;
