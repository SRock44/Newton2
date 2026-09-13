import { useEffect, useState } from "react";
import { getGamificationStats } from "../api";
import type { GamificationStats } from "../types";

interface ContextPanelProps {
  token: string;
  sessionCount: number;
  messageCount: number;
  /** Sum of prompt_tokens + completion_tokens across every message loaded for the
   * active chat — 0 (and hidden) if usage reporting isn't available, e.g. the keyless
   * dev EchoProvider or a BYOK Anthropic key, which don't report token counts. */
  totalTokens?: number;
}

/** Shows what's actually true right now — real session/message counts and live
 * progress. Deliberately holds nothing static or reference-only: "what Newton can do"
 * used to live here too, but that's help content, not live state, so it now lives
 * behind its own on-demand affordance (see HelpModal, opened from the sidebar's "?")
 * instead of permanently competing for space with things that actually change. */
function ContextPanel({ token, sessionCount, messageCount, totalTokens = 0 }: ContextPanelProps) {
  const [stats, setStats] = useState<GamificationStats | null>(null);

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
  }, [token]);

  return (
    <aside className="right-panel">
      <div className="right-panel-header">Newton context</div>

      <div className="panel-section">
        <div className="context-row">
          <span className="context-row-label">Chats</span>
          <span className="context-row-value">{sessionCount}</span>
        </div>
        <div className="context-row">
          <span className="context-row-label">This conversation</span>
          <span className="context-row-value">{messageCount} messages</span>
        </div>
        {totalTokens > 0 && (
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
  );
}

export default ContextPanel;
