import { useEffect, useState } from "react";
import { getGamificationStats } from "../api";
import type { GamificationStats, MainView } from "../types";
import {
  CONTEXT_PANEL_DEFAULT_WIDTH,
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  getContextPanelCollapsed,
  getContextPanelWidth,
  setContextPanelCollapsed,
  setContextPanelWidth,
} from "../lib/preferences";
import { usePanelResize } from "../lib/usePanelResize";
import PanelResizeHandle from "./PanelResizeHandle";

interface ContextPanelProps {
  token: string;
  sessionCount: number;
  messageCount: number;
  /** Sum of prompt_tokens + completion_tokens across every message loaded for the
   * active chat — 0 (and hidden) if usage reporting isn't available, e.g. the keyless
   * dev EchoProvider or a BYOK Anthropic key, which don't report token counts. */
  totalTokens?: number;
  /** Which page is currently showing (see App.tsx's mainView). `messageCount`/
   * `totalTokens` describe whatever chat session was LAST open, not necessarily the one
   * on screen right now — App.tsx never clears them on navigating away from chat, since
   * a student switching to Home and back should land exactly where they left off. This
   * panel is what needs to stop claiming a conversation is "open" once you've actually
   * navigated elsewhere, hence gating the "This conversation" / "Tokens used" rows on
   * `mainView === "chat"` rather than clearing that state itself. */
  mainView: MainView;
}

/** Shows what's actually true right now — real session/message counts and live
 * progress. Deliberately holds nothing static or reference-only: "what Newton can do"
 * used to live here too, but that's help content, not live state, so it now lives
 * behind its own on-demand affordance (see HelpModal, opened from the sidebar's "?")
 * instead of permanently competing for space with things that actually change. */
function ContextPanel({ token, sessionCount, messageCount, totalTokens = 0, mainView }: ContextPanelProps) {
  const [stats, setStats] = useState<GamificationStats | null>(null);
  const chatOpen = mainView === "chat";
  // Collapsible, same pattern/rationale as Sidebar.tsx's rail — window chrome, not
  // account data, persisted locally (see lib/preferences.ts).
  const [collapsed, setCollapsed] = useState(() => getContextPanelCollapsed());
  // Drag-to-resize, mirrored from Sidebar.tsx: this panel is on the RIGHT edge of the
  // window, so its handle is on its LEFT edge and dragging right makes it narrower —
  // hence direction: -1. Everything else (CSS custom property, persist-on-mouseup,
  // keyboard nudging) is the same shared hook.
  const resize = usePanelResize({
    initial: getContextPanelWidth(),
    defaultWidth: CONTEXT_PANEL_DEFAULT_WIDTH,
    min: CONTEXT_PANEL_MIN_WIDTH,
    max: CONTEXT_PANEL_MAX_WIDTH,
    direction: -1,
    persist: setContextPanelWidth,
  });

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      setContextPanelCollapsed(next);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    getGamificationStats(token)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch(() => {
        // Non-fatal — the rest of the panel still works without progress stats.
      });
    return () => {
      cancelled = true;
    };
    // Refetches on every view change, not just once on mount — otherwise this panel's
    // "Your progress" numbers go stale the moment they drift from whatever else is
    // reading the same live endpoint (e.g. HomeView's own progress widget, which fetches
    // fresh every time Home is opened).
  }, [token, mainView]);

  if (collapsed) {
    return (
      <aside className="right-panel right-panel--collapsed">
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={toggleCollapsed}
          aria-label="Expand Newton context"
          title="Expand Newton context"
        >
          «
        </button>
        {stats && stats.streak_days > 0 && (
          <div className="right-panel-collapsed-streak" title={`${stats.streak_days} day streak`}>
            🔥{stats.streak_days}
          </div>
        )}
      </aside>
    );
  }

  return (
    <>
      {/* Handle FIRST in DOM order — it sits on this panel's LEFT edge, so it precedes
          the panel as a flex item of .app-shell. The sidebar's mirror image, where the
          handle follows its panel instead. */}
      <PanelResizeHandle
        label="Resize Newton context"
        min={CONTEXT_PANEL_MIN_WIDTH}
        max={CONTEXT_PANEL_MAX_WIDTH}
        {...resize}
      />
      <aside
        className="right-panel"
        style={{ ["--context-panel-width" as string]: `${resize.width}px` }}
      >
        <div className="right-panel-header">
          <span>Newton context</span>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={toggleCollapsed}
            aria-label="Collapse Newton context"
            title="Collapse Newton context"
          >
            »
          </button>
        </div>

        <div className="panel-section">
          <div className="context-row">
            <span className="context-row-label">Chats</span>
            <span className="context-row-value">{sessionCount}</span>
          </div>
          {chatOpen && (
            <div className="context-row">
              <span className="context-row-label">This conversation</span>
              <span className="context-row-value">{messageCount} messages</span>
            </div>
          )}
          {chatOpen && totalTokens > 0 && (
            <div className="context-row">
              <span className="context-row-label">Tokens used</span>
              <span className="context-row-value">{totalTokens.toLocaleString()}</span>
            </div>
          )}
        </div>

        {stats && (
          <div className="panel-section">
            <div className="panel-section-title">Your progress</div>
            <div className="progress-stats">
              <div className="progress-stat">
                <span className="progress-stat-value">
                  {stats.streak_days > 0 ? `🔥 ${stats.streak_days}` : "0"}
                </span>
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
            <div className="progress-bar-caption">{stats.xp_to_next_level} XP to level {stats.level + 1}</div>
          </div>
        )}
      </aside>
    </>
  );
}

export default ContextPanel;
