import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import TitleBar from "./components/TitleBar";
import MessageContent from "./components/MessageContent";
import {
  ApiError,
  annotateNoteSelection,
  createNote,
  getNote,
  listNotes,
  updateNote,
} from "./api";
import type { Note, NoteAnnotateAction, NoteSummary } from "./types";
import { clearNoteDraft, loadNoteDraft, saveNoteDraft } from "./lib/noteDraft";

interface NotepadAuthPayload {
  token: string | null;
}

// How long to wait after the student stops typing before actually saving — long
// enough that normal typing never fires a save mid-word, short enough that a real
// crash right after stopping loses at most a few seconds of work (and even that's
// covered by the localStorage draft fallback below, written synchronously on every
// keystroke rather than debounced).
const AUTOSAVE_DEBOUNCE_MS = 2500;

// Capped surrounding context sent to POST /notes/{id}/annotate — the whole note's raw
// content, up to this length. Matches the backend's own MAX_CONTEXT_CHARS
// (app/services/notes.py) exactly: sending more than the backend will ever look at
// would just waste bandwidth on a long note.
const ANNOTATE_CONTEXT_CHARS = 4000;

type EditorMode = "write" | "preview";

interface SelectionToolbarState {
  text: string;
  top: number;
  left: number;
}

/** The always-on-top companion Notepad window's entire UI — a second Tauri webview
 * (label "notepad", see src-tauri/src/lib.rs's `show_notepad_window`) loading this same
 * bundle, branched to here instead of <App /> by main.tsx based on window label.
 *
 * A real mini-app: a compact note picker (GET/POST /notes), a Write/Preview editor for
 * the selected note's raw markdown (autosaved via a debounced PATCH /notes/{id}), and,
 * in Preview mode, a highlight-to-act toolbar (Explain/Define/Summarize) that inserts
 * Newton's response inline into the note itself — see app/routers/notes.py for the
 * backend side of all of this. Gets its auth token from the main window via a
 * `notepad-auth` event (App.tsx emits it once per sign-in and again on every background
 * token refresh) rather than having any login flow of its own. */
function NotepadWindow() {
  const [token, setToken] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<EditorMode>("write");
  const [loadingNote, setLoadingNote] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);
  const [annotating, setAnnotating] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Latest title/content, readable from the debounced-save callback without making it
  // (or the effect that (re)schedules it) depend on every keystroke.
  const latestRef = useRef({ title, content });
  latestRef.current = { title, content };

  // Auth: the main window pushes a live, valid token via this event — fired once when
  // it's known to be open/opening and again on every background refresh (see App.tsx).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<NotepadAuthPayload>("notepad-auth", (event) => setToken(event.payload.token)),
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

  const refreshNotes = useCallback(async () => {
    if (!token) return;
    try {
      setListError(null);
      setNotes(await listNotes(token));
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Couldn't load your notes.");
    }
  }, [token]);

  useEffect(() => {
    refreshNotes();
  }, [refreshNotes]);

  async function openNote(noteId: string) {
    if (!token) return;
    // Flush any pending debounced save for whatever note was open before switching.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setLoadingNote(true);
    setSelectionToolbar(null);
    try {
      const note: Note = await getNote(token, noteId);
      // A localStorage draft newer than the last successful save (see noteDraft.ts) —
      // e.g. a crash or network blip right before a debounced save landed — wins over
      // the server's copy, so that real typing is never silently lost.
      const draft = loadNoteDraft(noteId);
      setActiveNoteId(noteId);
      setTitle(draft?.title ?? note.title);
      setContent(draft?.content ?? note.content);
      setMode("write");
      setSaveState("idle");
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Couldn't open this note.");
    } finally {
      setLoadingNote(false);
    }
  }

  async function handleNewNote() {
    if (!token) return;
    try {
      const created = await createNote(token);
      await refreshNotes();
      await openNote(created.id);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Couldn't create a new note.");
    }
  }

  function backToPicker() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setActiveNoteId(null);
    setSelectionToolbar(null);
    refreshNotes();
  }

  const scheduleSave = useCallback(
    (noteId: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (!token) return;
        const { title: t, content: c } = latestRef.current;
        setSaveState("saving");
        try {
          await updateNote(token, noteId, t.trim() || "Untitled", c);
          clearNoteDraft(noteId);
          setSaveState("saved");
        } catch {
          // The draft is still sitting in localStorage from the synchronous write
          // below — nothing lost, just not yet synced to the server.
          setSaveState("error");
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [token],
  );

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!activeNoteId) return;
    saveNoteDraft(activeNoteId, { title: value, content });
    scheduleSave(activeNoteId);
  }

  function handleContentChange(value: string) {
    setContent(value);
    if (!activeNoteId) return;
    saveNoteDraft(activeNoteId, { title, content: value });
    scheduleSave(activeNoteId);
  }

  // Highlight-to-act: a real text selection inside the rendered Preview pane shows a
  // small floating toolbar near the selection.
  function handlePreviewMouseUp(_event: ReactMouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionToolbar(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text || !previewRef.current?.contains(selection.anchorNode)) {
      setSelectionToolbar(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setSelectionToolbar({ text, top: rect.top, left: rect.left });
  }

  async function handleAnnotate(action: NoteAnnotateAction) {
    if (!activeNoteId || !token || !selectionToolbar) return;
    const selectedText = selectionToolbar.text;
    setAnnotating(true);
    setSelectionToolbar(null);
    try {
      const generated = await annotateNoteSelection(
        token,
        activeNoteId,
        selectedText,
        content.slice(0, ANNOTATE_CONTEXT_CHARS),
        action,
      );
      const insertion = "\n\n```newton-note\n" + JSON.stringify({ action, text: generated }) + "\n```\n";
      // Insert right after the highlighted passage in the RAW markdown source. If the
      // exact selected text can't be found verbatim (e.g. it spanned rendered
      // formatting that doesn't match the raw source 1:1), fall back to appending at
      // the end rather than silently dropping the response.
      const index = content.indexOf(selectedText);
      const next =
        index === -1
          ? content + insertion
          : content.slice(0, index + selectedText.length) + insertion + content.slice(index + selectedText.length);
      handleContentChange(next);
    } catch {
      setListError("Couldn't get a response for that selection.");
    } finally {
      setAnnotating(false);
    }
  }

  const showPicker = activeNoteId === null;

  return (
    <div className="app-root">
      <TitleBar title="Newton Notepad" variant="notepad" />
      <div className="notepad-window">
        {!token ? (
          <div className="notepad-window__empty">Waiting for the main Newton window to sign in…</div>
        ) : showPicker ? (
          <div className="notepad-window__picker">
            <button type="button" className="btn-primary notepad-window__new" onClick={handleNewNote}>
              + New Note
            </button>
            {listError && <div className="notepad-window__error">{listError}</div>}
            {notes === null ? (
              <div className="notepad-window__empty">Loading your notes…</div>
            ) : notes.length === 0 ? (
              <div className="notepad-window__empty">No notes yet — create one to get started.</div>
            ) : (
              <ul className="notepad-window__note-list">
                {notes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      className="notepad-window__note-item"
                      onClick={() => openNote(note.id)}
                    >
                      <span className="notepad-window__note-title">{note.title}</span>
                      <span className="notepad-window__note-updated">
                        {new Date(note.updated_at).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="notepad-window__editor">
            <div className="notepad-window__editor-header">
              <button type="button" className="btn-secondary notepad-window__back" onClick={backToPicker}>
                ← Notes
              </button>
              <input
                type="text"
                className="notepad-window__title-input"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Untitled"
                disabled={loadingNote}
              />
            </div>
            <div className="notepad-window__toolbar">
              <div className="notepad-window__mode-toggle">
                <button
                  type="button"
                  className={mode === "write" ? "notepad-window__mode-btn--active" : "notepad-window__mode-btn"}
                  onClick={() => setMode("write")}
                >
                  Write
                </button>
                <button
                  type="button"
                  className={mode === "preview" ? "notepad-window__mode-btn--active" : "notepad-window__mode-btn"}
                  onClick={() => setMode("preview")}
                >
                  Preview
                </button>
              </div>
              <span className="notepad-window__save-status">
                {saveState === "saving" && "Saving…"}
                {saveState === "saved" && "Saved"}
                {saveState === "error" && "Couldn't save — kept locally"}
              </span>
            </div>
            <div className="notepad-window__body">
              {loadingNote ? (
                <div className="notepad-window__empty">Loading…</div>
              ) : mode === "write" ? (
                <textarea
                  className="notepad-window__textarea"
                  value={content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="Start writing…"
                />
              ) : (
                <div className="notepad-window__preview" ref={previewRef} onMouseUp={handlePreviewMouseUp}>
                  {content.trim() ? (
                    <MessageContent content={content} />
                  ) : (
                    <div className="notepad-window__empty">Nothing to preview yet.</div>
                  )}
                </div>
              )}
            </div>
            {selectionToolbar && (
              <div
                className="notepad-window__selection-toolbar"
                style={{ top: Math.max(selectionToolbar.top - 44, 4), left: Math.max(selectionToolbar.left, 4) }}
              >
                <button type="button" disabled={annotating} onClick={() => handleAnnotate("explain")}>
                  Explain
                </button>
                <button type="button" disabled={annotating} onClick={() => handleAnnotate("define")}>
                  Define
                </button>
                <button type="button" disabled={annotating} onClick={() => handleAnnotate("summarize")}>
                  Summarize
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default NotepadWindow;
