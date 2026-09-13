import { useEffect, useState } from "react";
import { listTools } from "../api";
import type { ToolInfo } from "../types";

interface HelpModalProps {
  token: string;
  onClose: () => void;
}

/** On-demand reference for "what Newton can do" — the live tool belt fetched from the
 * backend registry. This used to sit permanently in the right-hand context panel, but
 * it's reference material, not live state, so it doesn't deserve to compete for
 * screen space with things that actually change (progress, session stats). Opened
 * from the sidebar's "?" button; same modal chrome as Documents/Study plan/Flashcards/
 * Practice exams so it doesn't behave like a one-off. */
function HelpModal({ token, onClose }: HelpModalProps) {
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>What Newton can do</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="modal-subtitle">
          Newton reaches for these automatically during chat, whenever they'd help — nothing
          here needs to be turned on or invoked by name.
        </p>

        {error && <p className="panel-error">{error}</p>}
        {!error && !tools && <p className="panel-loading">Loading…</p>}
        {tools?.map((tool, i) => (
          <div key={tool.name} className="tool-row fade-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="tool-name">{tool.name.replace(/_/g, " ")}</div>
            <div className="tool-desc">{tool.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HelpModal;
