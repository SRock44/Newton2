import { useEffect, useState } from "react";
import { getGamificationStats, listTools } from "../api";
import type { ConnectionStatus, GamificationStats, ToolInfo } from "../types";

interface CapabilitiesPanelProps {
  token: string;
  connectionStatus: ConnectionStatus;
  sessionCount: number;
  messageCount: number;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  open: "connected",
  connecting: "connecting…",
  closed: "offline",
};

/** Shows what's actually true right now — connection state and real session/message
 * counts — plus the live tool belt fetched from the backend registry. Deliberately
 * doesn't show anything Newton can't really do yet (no Canvas/Classroom data exists),
 * so this panel never gets ahead of the product. */
function CapabilitiesPanel({ token, connectionStatus, sessionCount, messageCount }: CapabilitiesPanelProps) {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<GamificationStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTools(token)
      .then((result) => {
        if (!cancelled) setTools(result);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load Newton's tools.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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
          <span className="context-row-label">Connection</span>
          <span className="context-row-value">
            <span className={`live-dot live-dot--${connectionStatus}`} aria-hidden="true" />
            {STATUS_LABEL[connectionStatus]}
          </span>
        </div>
        <div className="context-row">
          <span className="context-row-label">Chats</span>
          <span className="context-row-value">{sessionCount}</span>
        </div>
        <div className="context-row">
          <span className="context-row-label">This conversation</span>
          <span className="context-row-value">{messageCount} messages</span>
        </div>
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

      <div className="panel-section">
        <div className="panel-section-title">What Newton can do</div>
        {error && <p className="panel-error">{error}</p>}
        {!error && !tools && <p className="panel-loading">Loading…</p>}
        {tools?.map((tool, i) => (
          <div key={tool.name} className="tool-row fade-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="tool-name">{tool.name.replace(/_/g, " ")}</div>
            <div className="tool-desc">{tool.description}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}

export default CapabilitiesPanel;
