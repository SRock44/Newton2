import { useEffect, useState } from "react";
import type { ChatSession, ConnectionStatus } from "../types";
import { sessionDisplayTitle } from "../lib/sessionTitle";
import NewtonMark from "./NewtonMark";

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  firstMessageBySession: Record<string, string>;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  creatingChat: boolean;
  username: string;
  onSignOut: () => void;
  onOpenDocuments: () => void;
  onOpenStudyPlan: () => void;
  onOpenFlashcards: () => void;
  onOpenPracticeExams: () => void;
  connectionStatus: ConnectionStatus;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  open: "connected",
  connecting: "connecting…",
  closed: "offline",
};

function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Sidebar({
  sessions,
  activeSessionId,
  firstMessageBySession,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  creatingChat,
  username,
  onSignOut,
  onOpenDocuments,
  onOpenStudyPlan,
  onOpenFlashcards,
  onOpenPracticeExams,
  connectionStatus,
}: SidebarProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">
            <NewtonMark size={15} />
          </span>
          <span className="sidebar-brand-name">Newton</span>
        </div>
        <span className="sidebar-status">
          <span className={`live-dot live-dot--${connectionStatus}`} aria-hidden="true" />
          {STATUS_LABEL[connectionStatus]}
        </span>
      </div>

      <div className="sidebar-clock">
        <div className="sidebar-clock-time">
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
        </div>
        <div className="sidebar-clock-date">
          {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </div>
      </div>

      <div className="sidebar-nav">
        <button type="button" className="btn-primary" onClick={onNewChat} disabled={creatingChat}>
          <span aria-hidden="true">+</span> {creatingChat ? "Starting…" : "New chat"}
        </button>

        <nav className="session-list" aria-label="Chat sessions">
          {sessions.length === 0 && <p className="empty-state-text">No chats yet.</p>}
          {sessions.map((session, i) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={`session-item fade-up${isActive ? " session-item--active" : ""}`}
                style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                data-context-menu="session"
                data-session-id={session.id}
              >
                <button
                  type="button"
                  className="session-item-main"
                  onClick={() => onSelectSession(session.id)}
                  aria-current={isActive}
                >
                  <span className="session-item-title">
                    {sessionDisplayTitle(session, firstMessageBySession[session.id])}
                  </span>
                  <span className="session-item-date">{formatSessionDate(session.created_at)}</span>
                </button>
                <button
                  type="button"
                  className="session-item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  aria-label="Delete chat"
                  title="Delete chat"
                >
                  ×
                </button>
              </div>
            );
          })}
        </nav>
      </div>

      <div className="sidebar-footer">
        <button type="button" className="sidebar-nav-more sidebar-nav-more--active" onClick={onOpenDocuments}>
          Documents
        </button>
        <button type="button" className="sidebar-nav-more sidebar-nav-more--active" onClick={onOpenStudyPlan}>
          Study plan
        </button>
        <button type="button" className="sidebar-nav-more sidebar-nav-more--active" onClick={onOpenFlashcards}>
          Flashcards
        </button>
        <button type="button" className="sidebar-nav-more sidebar-nav-more--active" onClick={onOpenPracticeExams}>
          Practice exams
        </button>
        <div className="sidebar-user">
          <span className="sidebar-user-name">{username}</span>
          <button type="button" className="btn-secondary-sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
