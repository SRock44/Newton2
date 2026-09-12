import { useEffect, useState } from "react";
import { listTools } from "../api";
import type { ConnectionStatus, ToolInfo } from "../types";

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
