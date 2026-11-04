import React from "react";
import ReactDOM from "react-dom/client";
// Public Sans carries every bit of body/UI text — chat, buttons, inputs, sidebar, labels.
// It's a distinct, highly legible grotesque (not Inter) that still feels calm over long
// study sessions.
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
// Fraunces is the editorial display face: the wordmark, every panel/section heading,
// dialog titles, and the empty-state "voice" copy. It's a variable font (weight + the
// "soft" and optical-size axes), so one import covers every heading weight/style this
// app uses instead of picking static cuts — see --font-serif/--font-serif-soft in App.css
// for how those axes get dialed in per use. This — not a token recolor — is the actual
// typographic identity change: Public Sans/Fraunces read nothing like the previous
// Inter/Source Serif 4 pairing in a side-by-side screenshot.
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "./App.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import NotepadWindow from "./NotepadWindow";
import ErrorBoundary from "./ErrorBoundary";
import { applyStoredAppearance } from "./lib/preferences";

/** The actual "mount the React tree" logic, factored out of main.tsx so apps/web's own
 * entry point (apps/web/src/main.tsx) can call the exact same function instead of being a
 * second, independently-maintained copy of it — the whole point of apps/web reusing this
 * src/ tree rather than reimplementing it (see the approved web-parity plan). This file
 * still lives in apps/desktop/src specifically so every import above (fonts, katex,
 * highlight.js, the Tauri window API) resolves against apps/desktop's own node_modules
 * automatically, with zero module-resolution aliasing needed for any of them — apps/web's
 * entry only has to alias react/react-dom themselves (the one place two separate copies
 * would actually break, via React's hook dispatcher singleton), not this whole list. */

// Settings → Appearance writes `data-theme`/`data-accent` onto <html> (see
// lib/preferences.ts's applyAppearance). Replaying it here — synchronously, before React
// mounts — is what stops a saved dark theme from flashing the light palette for a frame
// on every launch. Deliberately outside the isNotepadWindow() branch so the always-on-
// top Notepad companion window, which loads this exact same bundle, is themed too.
applyStoredAppearance();

// The always-on-top Notepad is a second window loading this exact same bundle (see
// src-tauri/src/lib.rs's `show_notepad_window`) — its window label, not its URL, is what
// distinguishes it, so branch here rather than routing. Falls back to the main app if
// there's no Tauri context at all (e.g. plain `vite dev` in a browser tab, or apps/web —
// which never has a second window to begin with, so this always resolves to `<App/>` there).
function isNotepadWindow(): boolean {
  try {
    return getCurrentWindow().label === "notepad";
  } catch {
    return false;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>{isNotepadWindow() ? <NotepadWindow /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
