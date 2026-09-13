import { useEffect, useState } from "react";
import MathSteps from "./components/MathSteps";

interface NotepadSyncPayload {
  json: string | null;
}

/** The always-on-top companion Notepad window's entire UI — a second Tauri webview
 * (label "notepad", see src-tauri/src/lib.rs's `show_notepad_window`) loading this same
 * bundle, branched to here instead of <App /> by main.tsx based on window label. It has
 * no chat, no login, no state of its own beyond what the main window pushes it: it just
 * listens for a `notepad-sync` event (emitted by App.tsx whenever the latest step-by-step
 * derivation in chat changes) and renders it, so a student can keep it pinned on screen
 * while working elsewhere. */
function NotepadWindow() {
  const [json, setJson] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<NotepadSyncPayload>("notepad-sync", (event) => setJson(event.payload.json)),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No Tauri context (e.g. this file under a test runner) — nothing to listen to.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="notepad-window">
      <header className="notepad-window__header">Newton Notepad</header>
      {json ? (
        <div className="notepad-window__body">
          <MathSteps json={json} />
        </div>
      ) : (
        <div className="notepad-window__empty">
          Waiting for a step-by-step derivation to show up in your chat…
        </div>
      )}
    </div>
  );
}

export default NotepadWindow;
