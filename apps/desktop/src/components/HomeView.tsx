import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getDocumentContent, getGamificationStats, getNote, listDocuments, listFlashcards, listNotes, listStudyPlan } from "../api";
import type { ChatSession, GamificationStats } from "../types";
import { sessionDisplayTitle } from "../lib/sessionTitle";
import { documentTypeLabel } from "../lib/fileType";
import { toSnippet } from "../lib/snippet";
import {
  HOME_WIDGET_IDS,
  HOME_WIDGET_LABELS,
  getHomeWidgetVisibility,
  setHomeWidgetVisibility,
} from "../lib/homeWidgets";
import type { HomeWidgetId } from "../lib/homeWidgets";
import RecentItemCard from "./RecentItemCard";

interface HomeViewProps {
  token: string;
  /** The stable JWT `sub` claim (see App.tsx's userIdFromAccessToken) — scopes the
   * customize toggle's persisted show/hide choices (see lib/homeWidgets.ts). */
  userId: string;
  sessions: ChatSession[];
  firstMessageBySession: Record<string, string>;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  creatingChat: boolean;
  /** Attached-document-chip-style navigation: opens the Documents page with this exact
   * document selected (App.tsx's handleOpenDocument) — same mechanism a chat message's
   * document chip already uses, not a new one. */
  onOpenDocument: (documentId: string) => void;
  /** Sidebar's own "Documents" nav action (App.tsx's handleToggleDocuments) — reused
   * as-is for the "Upload a document" quick action. */
  onOpenDocuments: () => void;
  onOpenStudyPlan: () => void;
  onOpenFlashcards: () => void;
  onOpenPracticeExams: () => void;
}

const RECENT_LIMIT = 6;
const CONVERSATIONS_LIMIT = 5;
const DUE_SOON_LIMIT = 6;

type RecentItem = {
  kind: "document" | "note";
  id: string;
  title: string;
  timestamp: string;
  typeLabel: string;
  snippet: string | null;
  tags?: string[];
};

type DueItem = {
  kind: "study" | "flashcard";
  id: string;
  title: string;
  due: string;
};

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Opens (or focuses, if already open) the Newton Notepad companion window — the real
 * `open_notepad_window` Tauri command (see src-tauri/src/lib.rs), the same window the
 * tray's "Open Notepad" menu item already opens. There's no in-app way to deep-link to
 * one specific note from the main window today, so both the "New note" quick action and
 * clicking a note card here just bring the Notepad's own note picker to the front — a
 * documented, deliberately small scope, not a missing feature. Wrapped in .catch() the
 * same way App.tsx's other Tauri calls are, since there's no real IPC bridge under a
 * bare test runner (jsdom) or a plain browser. */
function openNotepad() {
  invoke("open_notepad_window").catch(() => {
    // No Tauri context — nothing to open.
  });
}

/** The real dashboard / home screen — the default landing view (see App.tsx's
 * mainView), replacing an empty chat as the first thing a student sees. A curated,
 * fixed set of five widgets, each independently show/hide-able via "Customize" (see
 * lib/homeWidgets.ts) — deliberately NOT a drag-and-drop layout engine, a confirmed
 * scoping decision (see ROADMAP.md). */
function HomeView({
  token,
  userId,
  sessions,
  firstMessageBySession,
  onSelectSession,
  onNewChat,
  creatingChat,
  onOpenDocument,
  onOpenDocuments,
  onOpenStudyPlan,
  onOpenFlashcards,
  onOpenPracticeExams,
}: HomeViewProps) {
  const [recentItems, setRecentItems] = useState<RecentItem[] | null>(null);
  const [dueItems, setDueItems] = useState<DueItem[] | null>(null);
  const [stats, setStats] = useState<GamificationStats | null>(null);
  const [visibility, setVisibility] = useState(() => getHomeWidgetVisibility(userId));
  const [customizeOpen, setCustomizeOpen] = useState(false);

  useEffect(() => {
    setVisibility(getHomeWidgetVisibility(userId));
  }, [userId]);

  // "Recent documents & notes" — merges the two existing summary lists (no new backend
  // endpoint needed) and, only for the handful of items actually shown here (never the
  // full list), fetches each one's real content once to build a short snippet preview.
  // Renders the icon/title/date immediately off the summary lists; snippets arrive a
  // beat later as a second, non-blocking update.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [docs, notes] = await Promise.all([listDocuments(token), listNotes(token)]);
        if (cancelled) return;
        const merged: RecentItem[] = [
          ...docs.map((d) => ({
            kind: "document" as const,
            id: d.id,
            title: d.filename,
            timestamp: d.created_at,
            typeLabel: documentTypeLabel(d),
            snippet: null,
          })),
          ...notes.map((n) => ({
            kind: "note" as const,
            id: n.id,
            title: n.title,
            timestamp: n.updated_at,
            typeLabel: "NOTE",
            snippet: null,
            tags: n.tags,
          })),
        ];
        merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const top = merged.slice(0, RECENT_LIMIT);
        setRecentItems(top);

        const withSnippets = await Promise.all(
          top.map(async (item) => {
            try {
              const text =
                item.kind === "document"
                  ? (await getDocumentContent(token, item.id)).content
                  : (await getNote(token, item.id)).content;
              return { ...item, snippet: toSnippet(text) };
            } catch {
              return item; // snippet just stays unset — the card still renders fine without it
            }
          }),
        );
        if (!cancelled) setRecentItems(withSnippets);
      } catch {
        if (!cancelled) setRecentItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // "Due soon" — study plan items with a due date, plus already-due flashcards (FSRS
  // scheduling, see app/services/flashcard_generation.py), combined and sorted client-
  // side from the two existing endpoints App.tsx's own reminder effect already calls —
  // no new backend aggregation endpoint needed. A freshly-generated deck is due for its
  // FIRST review immediately (correct FSRS behavior, not a bug), which used to mean the
  // whole deck flooded this widget as individually near-unreadable rows at this card's
  // width — collapsed into one summary row instead, since "review your new deck" is one
  // action, not N rows that all say "Flashcard".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [studyItems, dueFlashcards] = await Promise.all([listStudyPlan(token), listFlashcards(token, true)]);
        if (cancelled) return;
        const combined: DueItem[] = studyItems
          .filter((item) => !!item.due_date)
          .map((item) => ({ kind: "study" as const, id: item.id, title: item.title, due: item.due_date! }));
        if (dueFlashcards.length > 0) {
          const earliestDue = dueFlashcards.reduce(
            (earliest, card) => (new Date(card.due) < new Date(earliest) ? card.due : earliest),
            dueFlashcards[0].due,
          );
          combined.push({
            kind: "flashcard",
            id: "flashcard-summary",
            title: `${dueFlashcards.length} flashcard${dueFlashcards.length === 1 ? "" : "s"} ready to review`,
            due: earliestDue,
          });
        }
        combined.sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
        setDueItems(combined.slice(0, DUE_SOON_LIMIT));
      } catch {
        if (!cancelled) setDueItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // "Your progress" — the exact same endpoint ContextPanel.tsx already uses, given a
  // real permanent home here rather than only living in the side panel.
  useEffect(() => {
    let cancelled = false;
    getGamificationStats(token)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch(() => {
        // Non-fatal — the widget just doesn't render, same as ContextPanel.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const toggleWidget = useCallback(
    (id: HomeWidgetId) => {
      setVisibility((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        setHomeWidgetVisibility(userId, next);
        return next;
      });
    },
    [userId],
  );

  const recentConversations = sessions.slice(0, CONVERSATIONS_LIMIT);

  return (
    <div className="home-view">
      <div className="home-view-toolbar">
        <p className="modal-subtitle">Everything you're working on, in one place.</p>
        <div className="home-view-customize">
          <button
            type="button"
            className="btn-secondary-sm"
            aria-haspopup="true"
            aria-expanded={customizeOpen}
            onClick={() => setCustomizeOpen((v) => !v)}
          >
            Customize
          </button>
          {customizeOpen && (
            <div className="home-customize-popover" role="menu" aria-label="Show or hide widgets">
              {HOME_WIDGET_IDS.map((id) => (
                <label key={id} className="home-customize-option">
                  <input type="checkbox" checked={visibility[id]} onChange={() => toggleWidget(id)} />
                  {HOME_WIDGET_LABELS[id]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="home-widgets">
        {visibility.quickActions && (
          <section className="home-widget home-widget--quick-actions" aria-label="Quick actions">
            <h2 className="home-widget-title">Quick actions</h2>
            <div className="home-quick-actions">
              <button type="button" className="btn-primary" onClick={onNewChat} disabled={creatingChat}>
                <span aria-hidden="true">+</span> {creatingChat ? "Starting…" : "New chat"}
              </button>
              <button type="button" className="btn-secondary" onClick={onOpenDocuments}>
                Upload a document
              </button>
              <button type="button" className="btn-secondary" onClick={openNotepad}>
                New note
              </button>
              <button type="button" className="btn-secondary" onClick={onOpenPracticeExams}>
                Start a practice session
              </button>
            </div>
          </section>
        )}

        {visibility.recent && (
          <section className="home-widget home-widget--recent" aria-label="Recent documents & notes">
            <h2 className="home-widget-title">Recent documents & notes</h2>
            {recentItems === null ? (
              <p className="empty-state-text">Loading…</p>
            ) : recentItems.length === 0 ? (
              <p className="empty-state-text">Upload a document or start a note to see it here.</p>
            ) : (
              <div className="home-recent-grid">
                {recentItems.map((item) => (
                  <RecentItemCard
                    key={`${item.kind}-${item.id}`}
                    typeLabel={item.typeLabel}
                    title={item.title}
                    timestamp={item.timestamp}
                    snippet={item.snippet}
                    tags={item.kind === "note" ? item.tags : undefined}
                    onClick={() => (item.kind === "document" ? onOpenDocument(item.id) : openNotepad())}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {visibility.conversations && (
          <section className="home-widget home-widget--conversations" aria-label="Continue a conversation">
            <h2 className="home-widget-title">Continue a conversation</h2>
            {recentConversations.length === 0 ? (
              <p className="empty-state-text">No chats yet — start one above.</p>
            ) : (
              <ul className="home-conversation-list">
                {recentConversations.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      className="home-conversation-item"
                      onClick={() => onSelectSession(session.id)}
                    >
                      <span className="home-conversation-title">
                        {sessionDisplayTitle(session, firstMessageBySession[session.id])}
                      </span>
                      <span className="home-conversation-date">{formatShortDate(session.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {visibility.dueSoon && (
          <section className="home-widget home-widget--due-soon" aria-label="Due soon">
            <h2 className="home-widget-title">Due soon</h2>
            {dueItems === null ? (
              <p className="empty-state-text">Loading…</p>
            ) : dueItems.length === 0 ? (
              <p className="empty-state-text">Nothing due — you're all caught up.</p>
            ) : (
              <ul className="home-due-list">
                {dueItems.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <button
                      type="button"
                      className="home-due-item"
                      onClick={() => (item.kind === "study" ? onOpenStudyPlan() : onOpenFlashcards())}
                    >
                      <span className="home-due-item-top">
                        <span className={`home-due-badge home-due-badge--${item.kind}`}>
                          {item.kind === "study" ? "Study plan" : "Flashcards"}
                        </span>
                        <span className="home-due-date">{formatShortDate(item.due)}</span>
                      </span>
                      <span className="home-due-title">{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {visibility.progress && stats && (
          <section className="home-widget home-widget--progress" aria-label="Your progress">
            <h2 className="home-widget-title">Your progress</h2>
            <div className="progress-stats">
              <div className="progress-stat">
                <span className="progress-stat-value">{stats.streak_days > 0 ? `🔥 ${stats.streak_days}` : "0"}</span>
                <span className="progress-stat-label">day streak</span>
              </div>
              <div className="progress-stat">
                <span className="progress-stat-value">Lv {stats.level}</span>
                <span className="progress-stat-label">{stats.xp} XP</span>
              </div>
            </div>
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${100 - (stats.xp_to_next_level / 100) * 100}%` }}
              />
            </div>
            <div className="progress-bar-caption">
              {stats.xp_to_next_level} XP to level {stats.level + 1}
            </div>
            <div className="progress-detail-grid">
              <div className="progress-detail-item">
                <span className="progress-detail-value">{stats.messages_sent}</span>
                <span className="progress-detail-label">Messages sent</span>
              </div>
              <div className="progress-detail-item">
                <span className="progress-detail-value">{stats.flashcards_reviewed}</span>
                <span className="progress-detail-label">Cards reviewed</span>
              </div>
              <div className="progress-detail-item">
                <span className="progress-detail-value">{stats.flashcards_created}</span>
                <span className="progress-detail-label">Cards created</span>
              </div>
              <div className="progress-detail-item">
                <span className="progress-detail-value">{stats.study_plan_items}</span>
                <span className="progress-detail-label">Plan items</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default HomeView;
