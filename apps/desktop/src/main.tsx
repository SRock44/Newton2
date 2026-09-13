import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./App.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import NotepadWindow from "./NotepadWindow";

// The always-on-top Notepad is a second window loading this exact same bundle (see
// src-tauri/src/lib.rs's `show_notepad_window`) — its window label, not its URL, is what
// distinguishes it, so branch here rather than routing. Falls back to the main app if
// there's no Tauri context at all (e.g. plain `vite dev` in a browser tab).
function isNotepadWindow(): boolean {
  try {
    return getCurrentWindow().label === "notepad";
  } catch {
    return false;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isNotepadWindow() ? <NotepadWindow /> : <App />}
  </React.StrictMode>,
);
