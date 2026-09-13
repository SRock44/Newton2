import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ApiError,
  connectClassroom,
  deleteStudyPlanItem,
  disconnectClassroom,
  getClassroomStatus,
  listStudyPlan,
  syncClassroom,
} from "../api";
import type { ClassroomStatus, StudyPlanItem } from "../types";

interface StudyPlanPanelProps {
  token: string;
  onClose: () => void;
}

const CLASSROOM_POLL_INTERVAL_MS = 3000;
const CLASSROOM_POLL_TIMEOUT_MS = 2 * 60 * 1000;

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

  const [classroom, setClassroom] = useState<ClassroomStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<{ interval: number; timeout: number } | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    getClassroomStatus(token)
      .then((status) => {
        if (!cancelled) setClassroom(status);
      })
      .catch(() => {
        // Non-fatal — the panel still works for syllabus-based items either way.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current.interval);
        window.clearTimeout(pollRef.current.timeout);
      }
    };
  }, []);

  async function handleDelete(id: string) {
    try {
      await deleteStudyPlanItem(token, id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove this item.");
    }
  }

  async function handleConnectClassroom() {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    try {
      const url = await connectClassroom(token);
      await openUrl(url);

      const interval = window.setInterval(async () => {
        try {
          const status = await getClassroomStatus(token);
          if (status.connected) {
            setClassroom(status);
            stopPollingClassroom();
            setConnecting(false);
          }
        } catch {
          // keep polling — a single failed check shouldn't abort the wait
        }
      }, CLASSROOM_POLL_INTERVAL_MS);

      const timeout = window.setTimeout(() => {
        stopPollingClassroom();
        setConnecting(false);
      }, CLASSROOM_POLL_TIMEOUT_MS);

      pollRef.current = { interval, timeout };
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start connecting Google Classroom.");
      setConnecting(false);
    }
  }

  function stopPollingClassroom() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current.interval);
      window.clearTimeout(pollRef.current.timeout);
      pollRef.current = null;
    }
  }

  async function handleSyncClassroom() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const synced = await syncClassroom(token);
      setItems((prev) => {
        const syncedIds = new Set(synced.map((i) => i.id));
        return [...prev.filter((i) => !syncedIds.has(i.id)), ...synced];
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sync Google Classroom.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnectClassroom() {
    try {
      await disconnectClassroom(token);
      setClassroom({ connected: false });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't disconnect Google Classroom.");
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

        <div className="classroom-connect">
          {classroom?.connected ? (
            <>
              <div className="classroom-connect-status">
                <span className="classroom-connect-dot" aria-hidden="true" />
                Google Classroom connected{classroom.google_email ? ` (${classroom.google_email})` : ""}
              </div>
              <div className="classroom-connect-actions">
                <button type="button" className="btn-secondary" onClick={handleSyncClassroom} disabled={syncing}>
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
                <button type="button" className="btn-secondary-sm" onClick={handleDisconnectClassroom}>
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="btn-secondary" onClick={handleConnectClassroom} disabled={connecting}>
              {connecting ? "Waiting for Google sign-in…" : "Connect Google Classroom"}
            </button>
          )}
        </div>

        {error && <div className="banner banner--error">{error}</div>}

        {loading ? (
          <p className="empty-state-text">Loading…</p>
        ) : items.length === 0 ? (
          <p className="empty-state-text">
            No study plan items yet — upload a syllabus in Documents and generate one.
          </p>
        ) : (
          <ul className="item-list">
            {items.map((item) => (
              <li key={item.id} className="item-row item-row--stacked">
                <div className="item-row-main">
                  <div>
                    <div className="item-title">{item.title}</div>
                    <div className="item-meta">{formatDueDate(item)}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    onClick={() => handleDelete(item.id)}
                    aria-label={`Remove ${item.title}`}
                  >
                    Remove
                  </button>
                </div>
                {item.notes && <div className="item-status">{item.notes}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default StudyPlanPanel;
