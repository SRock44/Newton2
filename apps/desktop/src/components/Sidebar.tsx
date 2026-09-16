import { useEffect, useState } from "react";
import type { ChatSession, MainView } from "../types";
import { sessionDisplayTitle } from "../lib/sessionTitle";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  getSidebarCollapsed,
  getSidebarWidth,
  setSidebarCollapsed,
  setSidebarWidth,
} from "../lib/preferences";
import { usePanelResize } from "../lib/usePanelResize";
import NewtonMark from "./NewtonMark";
import PanelResizeHandle from "./PanelResizeHandle";

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
  onOpenHome: () => void;
  onOpenDocuments: () => void;
  onOpenStudyPlan: () => void;
  onOpenCalendar: () => void;
  onOpenFlashcards: () => void;
  onOpenPracticeExams: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  /** Which page is currently showing (see App.tsx's mainView) — used only to highlight
   * the matching nav button; the sidebar's own session-list/navigation logic doesn't
   * otherwise depend on it. */
  mainView: MainView;
}

/** A compact icon-only label for the collapsed rail's nav buttons — first letter of
 * the full label, same idea as the existing "?" help button's single-glyph circle
 * (see .sidebar-help-btn), not a new icon set. */
function CollapsedNavButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sidebar-rail-btn${active ? " sidebar-rail-btn--active" : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {label.charAt(0)}
    </button>
  );
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
  onDeleteSession,
  creatingChat,
  username,
  onSignOut,
  onOpenHome,
  onOpenDocuments,
  onOpenStudyPlan,
  onOpenCalendar,
  onOpenFlashcards,
  onOpenPracticeExams,
  onOpenSettings,
  onOpenHelp,
  mainView,
}: SidebarProps) {
  const [now, setNow] = useState(new Date());
  // Collapsible sidebar: a slim icon-only rail when true. Persisted locally (see
  // lib/preferences.ts) so it survives a restart — a window-chrome preference, same
  // pattern as the existing study-reminders toggle.
  const [collapsed, setCollapsed] = useState(() => getSidebarCollapsed());
  // Drag-to-resize, persisted alongside the collapse flag. The width is published as a
  // CSS custom property on the <aside> itself rather than an inline `width`, so
  // App.css's `.sidebar` rule keeps owning the layout (and the collapsed rail keeps
  // ignoring it entirely) instead of an inline style overriding the stylesheet.
  const resize = usePanelResize({
    initial: getSidebarWidth(),
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    direction: 1,
    persist: setSidebarWidth,
  });

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      setSidebarCollapsed(next);
      return next;
    });
  }

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed">
        <div className="sidebar-header sidebar-header--collapsed">
          <button
            type="button"
            className={`sidebar-rail-brand${mainView === "home" ? " sidebar-rail-btn--active" : ""}`}
            onClick={onOpenHome}
            aria-label="Home"
            title="Home"
          >
            <NewtonMark size={15} />
          </button>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            »
          </button>
        </div>

        <div className="sidebar-rail">
          <CollapsedNavButton label="New chat" onClick={onNewChat} />
          <CollapsedNavButton label="Documents" active={mainView === "documents"} onClick={onOpenDocuments} />
          <CollapsedNavButton label="Study plan" onClick={onOpenStudyPlan} />
          <CollapsedNavButton label="Calendar" onClick={onOpenCalendar} />
          <CollapsedNavButton label="Flashcards" onClick={onOpenFlashcards} />
          <CollapsedNavButton label="Practice exams" onClick={onOpenPracticeExams} />
          <CollapsedNavButton label="Settings" onClick={onOpenSettings} />
          <CollapsedNavButton label="What Newton can do" onClick={onOpenHelp} />
        </div>

        <div className="sidebar-rail sidebar-rail--footer">
          <CollapsedNavButton label="Sign out" onClick={onSignOut} />
        </div>
      </aside>
    );
  }

  return (
    <>
      <aside
        className="sidebar"
        style={{ ["--sidebar-width" as string]: `${resize.width}px` }}
      >
        <div className="sidebar-header">
          <button
            type="button"
            className={`sidebar-brand${mainView === "home" ? " sidebar-brand--active" : ""}`}
            onClick={onOpenHome}
            aria-label="Home"
            title="Home"
          >
            <span className="sidebar-brand-mark">
              <NewtonMark size={15} />
            </span>
            <span className="sidebar-brand-name">Newton</span>
          </button>
          <div className="sidebar-header-actions">
            <button
              type="button"
              className="sidebar-collapse-toggle"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              «
            </button>
            <button
              type="button"
              className="sidebar-help-btn"
              onClick={onOpenHelp}
              aria-label="What Newton can do"
              title="What Newton can do"
            >
              ?
            </button>
          </div>
        </div>

        <div className="sidebar-clock">
          <div className="sidebar-clock-time">
            {/* No `hour12` override: follows the user's own locale/OS preference. */}
            {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
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
          <button
            type="button"
            className={`sidebar-nav-more sidebar-nav-more--active${mainView === "documents" ? " sidebar-nav-more--current" : ""}`}
            onClick={onOpenDocuments}
          >
            Documents
          </button>
          <button type="button" className="sidebar-nav-more sidebar-nav-more--active" onClick={onOpenStudyPlan}>
            Study plan
          </button>
          <button type="button" className="sidebar-nav-more sidebar-nav-more--active" onClick={onOpenCalendar}>
            Calendar
          </button>
          <button type="button" className="sidebar-nav-more sidebar-nav-more--active" onClick={onOpenFlashcards}>
            Flashcards
          </button>
          <button type="button" className="sidebar-nav-more sidebar-nav-more--active" onClick={onOpenPracticeExams}>
            Practice exams
          </button>
          <button type="button" className="sidebar-nav-more sidebar-nav-more--active" onClick={onOpenSettings}>
            Settings
          </button>
          <div className="sidebar-user">
            <span className="sidebar-user-name">{username}</span>
            <button type="button" className="btn-secondary-sm" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      {/* Follows the <aside> because it sits on the sidebar's RIGHT edge — see
          PanelResizeHandle's own comment for why it's a sibling rather than a child. */}
      <PanelResizeHandle label="Resize sidebar" min={SIDEBAR_MIN_WIDTH} max={SIDEBAR_MAX_WIDTH} {...resize} />
    </>
  );
}

export default Sidebar;
