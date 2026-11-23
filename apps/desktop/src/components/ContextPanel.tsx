import { useEffect, useState } from "react";
import { getGamificationStats } from "../api";
import type { GamificationStats, MainView } from "../types";
import SidebarFrame from "./SidebarFrame";
import { webSidebarsEnabled } from "../lib/webSidebars";

export interface ContextPanelProps {
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
export default function ContextPanel({ token, sessionCount, messageCount, totalTokens = 0, mainView }: ContextPanelProps) {
  const web = webSidebarsEnabled();
  const [stats, setStats] = useState<GamificationStats | null>(null);
  const chatOpen = mainView === "chat";

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

  const progress = stats ? Math.max(0, Math.min(100, 100 - stats.xp_to_next_level)) : 0;
  const content = (
    <>
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
          <div
            className="progress-bar-track" role={web ? "progressbar" : undefined}
            aria-label={web ? `Progress to level ${stats.level + 1}` : undefined}
            aria-valuemin={web ? 0 : undefined} aria-valuemax={web ? 100 : undefined}
            aria-valuenow={web ? progress : undefined}
          >
            <div
              className="progress-bar-fill"
              style={{ width: `${web ? progress : 100 - (stats.xp_to_next_level / 100) * 100}%` }}
            />
          </div>
          <div className="progress-bar-caption">{stats.xp_to_next_level} XP to level {stats.level + 1}</div>
        </div>
      )}
    </>
  );

  const Streak = web ? "span" : "div";
  return (
    <SidebarFrame
      side="right" label="Newton context" tour="context-panel"
      rail={({ toggle }) => (
        <>
          {toggle}
          {stats && stats.streak_days > 0 && (
            <Streak className={web ? "web-sidebar-streak" : "right-panel-collapsed-streak"} title={`${stats.streak_days} day streak`}>
              🔥{stats.streak_days}
            </Streak>
          )}
        </>
      )}
    >
      {({ toggle }) => {
        const panel = <><div className="right-panel-header"><span>Newton context</span>{toggle}</div>{content}</>;
        return web ? <div className="web-sidebar-content web-context-content">{panel}</div> : panel;
      }}
    </SidebarFrame>
  );
}
