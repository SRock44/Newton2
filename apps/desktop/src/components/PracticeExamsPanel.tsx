import { useEffect, useState } from "react";
import {
  ApiError,
  createShareLink,
  deletePracticeExam,
  getPracticeExam,
  listPracticeExams,
  revokeShareLink,
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

  // Public share link for the exam currently open. Keyed by exam id so switching exams
  // never shows one exam's "Stop sharing" state on another's.
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareLinkByExam, setShareLinkByExam] = useState<Record<string, string>>({});

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

  /** Mints a public, read-only web page for one exam and copies its URL.
   *
   * The page is served by the Newton API itself and readable with no Newton account —
   * that's the point — and authorized purely by an unguessable token in the path, so the
   * link should be treated like a password.
   *
   * It preserves the app's own "don't leak answers before completion" rule: an exam that
   * hasn't been submitted yet renders questions and choices only, with no answer key and
   * no explanations (see services/api/app/routers/share.py). Sharing an un-taken exam with
   * a classmate to study from is therefore safe by construction, not by remembering to. */
  async function handleShare(examId: string) {
    if (sharing) return;
    setSharing(true);
    setShareStatus(null);
    setError(null);
    try {
      const link = await createShareLink(token, { kind: "practice_exam", exam_id: examId });
      await navigator.clipboard.writeText(link.url);
      setShareLinkByExam((prev) => ({ ...prev, [examId]: link.id }));
      setShareStatus(`Link copied — anyone with it can view this exam. ${link.url}`);
    } catch (err) {
      setShareStatus(err instanceof ApiError ? err.message : "Couldn't create a share link.");
    } finally {
      setSharing(false);
    }
  }

  async function handleStopSharing(examId: string) {
    const linkId = shareLinkByExam[examId];
    if (sharing || !linkId) return;
    setSharing(true);
    try {
      await revokeShareLink(token, linkId);
      setShareLinkByExam((prev) => {
        const next = { ...prev };
        delete next[examId];
        return next;
      });
      setShareStatus("Sharing stopped — that link no longer works.");
    } catch (err) {
      setShareStatus(err instanceof ApiError ? err.message : "Couldn't revoke this share link.");
    } finally {
      setSharing(false);
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
        {shareStatus && <div className="item-status">{shareStatus}</div>}

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
                    <div className="item-row-actions">
                      {shareLinkByExam[exam.id] ? (
                        <button
                          type="button"
                          className="btn-secondary-sm"
                          onClick={() => handleStopSharing(exam.id)}
                          disabled={sharing}
                          aria-label={`Stop sharing exam: ${exam.title}`}
                        >
                          Stop sharing
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary-sm"
                          onClick={() => handleShare(exam.id)}
                          disabled={sharing}
                          aria-label={`Share exam: ${exam.title}`}
                          title="Copy a public, read-only web link anyone can open — no Newton account needed"
                        >
                          Share
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary-sm btn-secondary-sm--danger"
                        onClick={() => handleDelete(exam.id)}
                        aria-label={`Delete exam: ${exam.title}`}
                      >
                        Delete
                      </button>
                    </div>
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
