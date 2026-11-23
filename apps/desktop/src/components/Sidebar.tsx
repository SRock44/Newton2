import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ChatSession, MainView } from "../types";
import { sessionDisplayTitle } from "../lib/sessionTitle";
import NewtonMark from "./NewtonMark";
import SidebarFrame from "./SidebarFrame";
import { webSidebarsEnabled } from "../lib/webSidebars";
import SidebarIcon from "./web/SidebarIcon";
import type { SidebarIconName } from "./web/SidebarIcon";

export interface SidebarProps {
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

interface SidebarLink {
  action: string;
  label: string;
  icon: SidebarIconName;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Sidebar({
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
  const web = webSidebarsEnabled();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const links: SidebarLink[] = [
    { action: "home", label: "Home", icon: "house", onClick: onOpenHome, active: mainView === "home" },
    { action: "new-chat", label: "New chat", icon: "square-pen", onClick: onNewChat, disabled: creatingChat },
    { action: "documents", label: "Documents", icon: "files", onClick: onOpenDocuments, active: mainView === "documents" },
    { action: "study-plan", label: "Study plan", icon: "clipboard-list", onClick: onOpenStudyPlan },
    { action: "calendar", label: "Calendar", icon: "calendar-days", onClick: onOpenCalendar },
    { action: "flashcards", label: "Flashcards", icon: "layers", onClick: onOpenFlashcards },
    { action: "exams", label: "Practice exams", icon: "clipboard-check", onClick: onOpenPracticeExams },
  ];
  const footer: SidebarLink[] = [
    { action: "settings", label: "Settings", icon: "settings", onClick: onOpenSettings },
    { action: "help", label: "What Newton can do", icon: "circle-question-mark", onClick: onOpenHelp },
  ];
  const signOut: SidebarLink = { action: "signout", label: "Sign out", icon: "log-out", onClick: onSignOut };

  function renderRailLink(link: SidebarLink) {
    return (
      <button
        key={link.action} type="button" onClick={link.onClick} aria-label={link.label} title={link.label}
        className={web
          ? `web-sidebar-rail-button${link.action === "signout" ? " web-sidebar-signout" : ""}`
          : `sidebar-rail-btn${link.active ? " sidebar-rail-btn--active" : ""}`}
        data-sidebar-action={web ? link.action : undefined}
        aria-current={web && link.active ? "page" : undefined}
        disabled={web ? link.disabled : undefined}
      >
        {web ? <SidebarIcon name={link.icon} /> : link.label.charAt(0)}
      </button>
    );
  }

  function renderLink(link: SidebarLink) {
    return (
      <button
        key={link.action} type="button" onClick={link.onClick} disabled={link.disabled}
        className={web
          ? `web-sidebar-link${link.active ? " web-sidebar-link--active" : ""}`
          : `sidebar-nav-more sidebar-nav-more--active${link.active ? " sidebar-nav-more--current" : ""}`}
        data-sidebar-action={web ? link.action : undefined}
        aria-current={web && link.active ? "page" : undefined}
      >
        {web ? <><SidebarIcon name={link.icon} /><span>{link.action === "new-chat" && creatingChat ? "Starting…" : link.label}</span></> : link.label}
      </button>
    );
  }

  const sessionList = (
    <nav className="session-list" aria-label="Chat sessions">
      {sessions.length === 0 && <p className="empty-state-text">No chats yet.</p>}
      {sessions.map((session, i) => {
        const isActive = session.id === activeSessionId;
        return (
          <div
            key={session.id}
            className={`session-item${web ? "" : " fade-up"}${isActive ? " session-item--active" : ""}`}
            style={web ? undefined : { animationDelay: `${Math.min(i, 12) * 20}ms` }}
            data-context-menu="session" data-session-id={session.id}
          >
            <button type="button" className="session-item-main" onClick={() => onSelectSession(session.id)} aria-current={isActive}>
              <span className="session-item-title">{sessionDisplayTitle(session, firstMessageBySession[session.id])}</span>
              <span className="session-item-date">{formatSessionDate(session.created_at)}</span>
            </button>
            <button
              type="button" className="session-item-delete" aria-label="Delete chat" title="Delete chat"
              onClick={(event) => { event.stopPropagation(); onDeleteSession(session.id); }}
            >
              ×
            </button>
          </div>
        );
      })}
    </nav>
  );

  function renderContent(toggle: ReactNode, open: boolean) {
    return (
      <>
        <div className="sidebar-header">
          <button
            type="button"
            className={`sidebar-brand${!web && mainView === "home" ? " sidebar-brand--active" : ""}`}
            onClick={onOpenHome}
            aria-label={web ? "Newton home" : "Home"}
            title={web ? undefined : "Home"}
            data-tour={open ? "sidebar-brand" : undefined}
          >
            <span className="sidebar-brand-mark">
              <NewtonMark size={15} />
            </span>
            <span className="sidebar-brand-name">Newton</span>
          </button>
          {web ? toggle : <div className="sidebar-header-actions">
            {toggle}
            <button
              type="button"
              className="sidebar-help-btn"
              onClick={onOpenHelp}
              aria-label="What Newton can do"
              title="What Newton can do"
            >
              ?
            </button>
          </div>}
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

        {web ? (
          <div className="web-sidebar-scroll">
            <nav className="web-sidebar-links" aria-label="Main navigation">{links.map(renderLink)}</nav>
            <div className="web-sidebar-recent"><h2>Recent conversations</h2>{sessionList}</div>
          </div>
        ) : <div className="sidebar-nav">
          <button type="button" className="btn-primary" onClick={onNewChat} disabled={creatingChat}>
            <span aria-hidden="true">+</span> {creatingChat ? "Starting…" : "New chat"}
          </button>

          {sessionList}
        </div>}

        <div className="sidebar-footer">
          {(web ? footer : [...links.slice(2), footer[0]]).map(renderLink)}
          <div className="sidebar-user">
            <span className="sidebar-user-name">{username}</span>
            <button
              type="button" className={`btn-secondary-sm${web ? " web-sidebar-signout-button" : ""}`} onClick={onSignOut}
              data-sidebar-action={web ? "signout" : undefined}
            >
              {web ? <><SidebarIcon name="log-out" /><span>Sign out</span></> : "Sign out"}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <SidebarFrame
      side="left" label="sidebar"
      rail={({ toggle, open }) => {
        const home = (
          <button
            type="button" onClick={onOpenHome} aria-label="Home" title="Home"
            className={web ? "web-sidebar-rail-button" : `sidebar-rail-brand${mainView === "home" ? " sidebar-rail-btn--active" : ""}`}
            aria-current={web && mainView === "home" ? "page" : undefined}
            data-sidebar-action={web ? "home" : undefined} data-tour={web && !open ? "sidebar-brand" : undefined}
          >
            <NewtonMark size={web ? 18 : 15} />
          </button>
        );
        const navigation = [...links.slice(1), ...footer].map(renderRailLink);
        const signout = renderRailLink(signOut);
        return web ? <>{home}{toggle}{navigation}{signout}</> : (
          <>
            <div className="sidebar-header sidebar-header--collapsed">{home}{toggle}</div>
            <div className="sidebar-rail">{navigation}</div>
            <div className="sidebar-rail sidebar-rail--footer">{signout}</div>
          </>
        );
      }}
    >
      {({ toggle, open }) => web
        ? <div className="web-sidebar-content">{renderContent(toggle, open)}</div>
        : renderContent(toggle, open)}
    </SidebarFrame>
  );
}
