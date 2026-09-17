import { useEffect, useRef, useState } from "react";
import { API_URL } from "../api";
import { fetchBytes, saveBytesToDisk } from "../lib/download";

/**
 * Fenced-block contract — a generated Artifact (see services/api/app/tools/
 * create_artifact.py), the live-rendered sibling of ```plotly-figure:
 *
 * ```newton-artifact
 * {
 *   "document_id": "…uuid…",
 *   "title": "Nitrogen Cycle",
 *   "kind": "diagram" | "chart" | "slideshow" | "interactive",
 *   "attempts": 1
 * }
 * ```
 *
 * The block deliberately carries only the document id, never the HTML itself: an
 * artifact is a whole web page, and inlining it in the chat message would paste it back
 * into the model's own context on every following turn of the conversation. The real
 * bytes are fetched here from GET /documents/{id}/raw, the same auth-gated
 * fetch-with-bearer-token path the PDF preview and the Documents panel's download
 * already use (see lib/download.ts's fetchBytes, reused directly).
 *
 * ── THE SANDBOX, which is the whole security story here ──────────────────────────────
 * The artifact is arbitrary JavaScript written by a coding agent from a prompt a student
 * typed. It runs in an <iframe sandbox="allow-scripts"> — and specifically WITHOUT
 * allow-same-origin. That combination is load-bearing, not decorative:
 *
 *   - `sandbox` with allow-scripts but no allow-same-origin forces the frame into an
 *     OPAQUE ORIGIN. Its document.cookie, localStorage, sessionStorage and IndexedDB are
 *     inaccessible (they throw), and every same-origin check against the app's real
 *     origin fails. So artifact JS cannot read the student's bearer token, their chat
 *     history, or anything else the app keeps client-side, even though it is running
 *     real script.
 *   - Adding allow-same-origin alongside allow-scripts would undo the entire sandbox —
 *     the frame could then reach into window.parent and script the app directly. The two
 *     must never both be present. That is why this component hardcodes the attribute
 *     rather than accepting it as a prop.
 *   - Not granted, deliberately: allow-forms, allow-popups, allow-modals,
 *     allow-top-navigation (an artifact must never be able to navigate the app away),
 *     allow-downloads, allow-pointer-lock, allow-presentation.
 *   - `srcdoc` (not src=<the raw URL>) means the frame never performs a top-level
 *     navigation to an app URL at all, so there is no authenticated document load to
 *     inherit anything from — the bytes are handed to an already-sandboxed frame.
 *   - `referrerPolicy="no-referrer"` and a `csp`-style belt-and-braces aren't needed on
 *     top of this because the artifact is validated server-side to contain no external
 *     references at all (services/artifact-runner's _validate_html), but the sandbox is
 *     what makes that a defence in depth rather than the only line.
 *
 * Download reuses lib/download.ts exactly like the Documents panel and the Anki export
 * do — one place in the app knows how a file is saved.
 */

export interface ArtifactBlockData {
  documentId: string;
  title: string;
  kind: string;
  attempts: number;
}

const KIND_LABELS: Record<string, string> = {
  diagram: "Diagram",
  chart: "Chart",
  slideshow: "Slideshow",
  interactive: "Interactive",
};

/** The exact sandbox token list — exported so the test can assert on it directly and a
 * future edit that adds "allow-same-origin" fails loudly instead of silently removing
 * the isolation. See the contract comment above for why each is or isn't here. */
export const ARTIFACT_SANDBOX = "allow-scripts";

export function parseArtifactBlock(json: string): ArtifactBlockData | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.document_id !== "string" || !parsed.document_id.trim()) return null;
    if (typeof parsed.title !== "string" || !parsed.title.trim()) return null;
    const kind = typeof parsed.kind === "string" ? parsed.kind : "";
    const attempts = typeof parsed.attempts === "number" ? parsed.attempts : 1;
    return { documentId: parsed.document_id, title: parsed.title, kind, attempts };
  } catch {
    return null;
  }
}

interface ArtifactBlockProps {
  json: string;
  /** Bearer token for the auth-gated raw-bytes fetch. Undefined in a context with no
   * signed-in session (e.g. a block rendered in isolation in a test) — the component
   * then shows an honest "couldn't load" state rather than firing an unauthed request. */
  token?: string;
}

function ArtifactBlock({ json, token }: ArtifactBlockProps) {
  const block = parseArtifactBlock(json);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Kept as bytes as well as text: the download writes the EXACT stored bytes rather
  // than re-encoding the string, the same rule lib/download.ts's own docstring sets out.
  const bytesRef = useRef<Uint8Array | null>(null);

  const documentId = block?.documentId;

  useEffect(() => {
    if (!documentId) return;
    if (!token) {
      setError("Couldn't load this artifact (not signed in).");
      return;
    }
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const bytes = await fetchBytes(`${API_URL}/documents/${documentId}/raw`, token);
        if (cancelled) return;
        bytesRef.current = bytes;
        setHtml(new TextDecoder().decode(bytes));
      } catch {
        if (!cancelled) setError("Couldn't load this artifact.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, token]);

  if (!block) {
    return <div className="artifact-block artifact-block--error">Couldn't render this artifact.</div>;
  }

  async function handleDownload() {
    const bytes = bytesRef.current;
    if (!bytes || !block) return;
    setSaveStatus(null);
    try {
      const result = await saveBytesToDisk(`${block.title}.html`, bytes, [
        { name: "HTML file", extensions: ["html"] },
      ]);
      // A cancelled save dialog is a completely normal outcome, not an error — say
      // nothing, exactly as the Documents panel's download does.
      if (result.path) setSaveStatus("Saved.");
    } catch {
      setSaveStatus("Couldn't save the file.");
    }
  }

  const kindLabel = KIND_LABELS[block.kind] ?? "Artifact";

  return (
    <div className={`artifact-block${expanded ? " artifact-block--expanded" : ""}`}>
      <div className="artifact-block__header">
        <span className="artifact-block__kind">{kindLabel}</span>
        <span className="artifact-block__title">{block.title}</span>
        <div className="artifact-block__actions">
          <button
            type="button"
            className="btn-secondary-sm"
            onClick={() => setExpanded((v) => !v)}
            aria-pressed={expanded}
          >
            {expanded ? "Shrink" : "Expand"}
          </button>
          <button
            type="button"
            className="btn-secondary-sm"
            onClick={handleDownload}
            disabled={!html}
            aria-label={`Download ${block.title}`}
          >
            Download
          </button>
        </div>
      </div>

      {error ? (
        <div className="banner banner--error">{error}</div>
      ) : html === null ? (
        <div className="artifact-block__loading">Loading artifact…</div>
      ) : (
        <iframe
          className="artifact-block__frame"
          title={block.title}
          srcDoc={html}
          /* See this file's contract comment. allow-same-origin must never be added
             here: with allow-scripts it would give artifact JS the app's own origin. */
          sandbox={ARTIFACT_SANDBOX}
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}

      {saveStatus && <div className="item-status">{saveStatus}</div>}
      <p className="artifact-block__footnote">
        Built by a coding agent and saved to your files. It runs isolated — it can't see
        anything else in Newton.
      </p>
    </div>
  );
}

export default ArtifactBlock;
