import type { ChatSession } from "../types";
import { sessionDisplayTitle } from "../lib/sessionTitle";

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  firstMessageBySession: Record<string, string>;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  creatingChat: boolean;
  username: string;
  onSignOut: () => void;
}

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
  creatingChat,
  username,
  onSignOut,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-brand">Newton</span>
      </div>

      <button type="button" className="new-chat-btn" onClick={onNewChat} disabled={creatingChat}>
        <span aria-hidden="true">+</span> {creatingChat ? "Starting…" : "New chat"}
      </button>

      <nav className="session-list" aria-label="Chat sessions">
        {sessions.length === 0 && <p className="session-list-empty">No chats yet.</p>}
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <button
              type="button"
              key={session.id}
              className={`session-item${isActive ? " session-item--active" : ""}`}
              onClick={() => onSelectSession(session.id)}
              aria-current={isActive}
            >
              <span className="session-item-title">
                {sessionDisplayTitle(session, firstMessageBySession[session.id])}
              </span>
              <span className="session-item-date">{formatSessionDate(session.created_at)}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-nav-more" aria-disabled="true" title="Coming soon">
          Documents & flashcards — coming soon
        </div>
        <div className="sidebar-user">
          <span className="sidebar-user-name">{username}</span>
          <button type="button" className="sidebar-signout" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
