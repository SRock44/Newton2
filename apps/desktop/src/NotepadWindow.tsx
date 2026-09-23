import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import TitleBar from "./components/TitleBar";
import ContextMenu from "./components/ContextMenu";
import NoteEditor from "./components/NoteEditor";
import {
  ApiError,
  annotateNoteSelection,
  createNote,
  deleteNote,
  getNote,
  listNotes,
  updateNote,
  updateNoteTags,
} from "./api";
import type { Note, NoteAnnotateAction, NoteSummary } from "./types";
import { clearNoteDraft, loadNoteDraft, saveNoteDraft } from "./lib/noteDraft";
import { useVoiceRecorder } from "./lib/useVoiceRecorder";

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

// Lecture capture (voice recording): rather than recording a whole lecture as one long
// blob and transcribing it all at the end (one failure near the end would risk losing
// everything), the recorder is stopped and restarted on this interval, each finished
// segment transcribed and appended to the note as soon as it's ready. 45s is a
// reasonable middle ground -- short enough that a mid-lecture failure loses at most
// under a minute, long enough that whisper-asr isn't called on a constant stream of
// tiny near-silent clips.
const RECORDING_SEGMENT_MS = 45_000;

// Notepad auth race fix (ROADMAP.md "stuck on Waiting... even when signed in"): how long
// to wait for the main window to answer this window's "notepad-ready" request (see the
// auth effect below) before showing a "Sign in" fallback button instead of just sitting
// on the plain waiting text. The round trip should resolve almost instantly for the
// (overwhelmingly common) genuinely-signed-in case -- this is a real timeout for the
// genuinely-signed-out case, not a guess at typical IPC latency, so it's set with real
// headroom above what a healthy round trip should ever take.
const AUTH_FALLBACK_TIMEOUT_MS = 4_000;

interface SelectionToolbarState {
  text: string;
  top: number;
  left: number;
}

/** The always-on-top companion Notepad window's entire UI — a second Tauri webview
 * (label "notepad", see src-tauri/src/lib.rs's `show_notepad_window`) loading this same
 * bundle, branched to here instead of <App /> by main.tsx based on window label.
 *
 * A real mini-app: a compact note picker (GET/POST /notes), a single live editor for
 * the selected note's raw markdown (NoteEditor.tsx: rendered until you click into it, Newton's
 * answers always shown as cards; autosaved via a debounced PATCH /notes/{id}), and a
 * highlight-to-act toolbar (Explain/Define/Summarize) that inserts
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
  const [tags, setTags] = useState<string[]>([]);
  const [loadingNote, setLoadingNote] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);
  const [annotating, setAnnotating] = useState(false);

  // Right-click rename (ContextMenu's "note-item" kind, see ContextMenu.tsx) — an
  // inline text input replaces the note-list row's title while renamingNoteId matches
  // it, rather than a separate modal/prompt.
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Tag popover (list row's or editor header's small tag icon button) — a compact
  // inline panel, not a floating overlay, so there's no positioning math to get wrong
  // in a small always-on-top window. `tagPopoverTags` is a live, server-confirmed copy
  // of whichever note's tags are open, kept in sync on every add/remove.
  const [tagPopoverNoteId, setTagPopoverNoteId] = useState<string | null>(null);
  const [tagPopoverTags, setTagPopoverTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest title/content, readable from the debounced-save callback without making it
  // (or the effect that (re)schedules it) depend on every keystroke.
  const latestRef = useRef({ title, content });
  latestRef.current = { title, content };

  // Lecture capture (voice recording) — the shared recorder mechanics (see
  // lib/useVoiceRecorder.ts), chunked into RECORDING_SEGMENT_MS segments so a failure
  // mid-lecture loses at most one segment. The only Notepad-specific part left here is
  // what happens to the text: appended to the open note as plain, directly-editable
  // content — unlike the read-only newton-note Explain/Define/Summarize blocks, this is
  // the student's own captured material.
  const {
    recording,
    transcribing,
    elapsedSeconds: recordingSeconds,
    error: recordingError,
    start: startRecording,
    stop: stopRecording,
  } = useVoiceRecorder({
    token,
    segmentMs: RECORDING_SEGMENT_MS,
    onTranscript: (text) => {
      // A segment can land just after the student closed the note (the upload was
      // already in flight) — there's nowhere to put it then, so it's dropped rather
      // than written into whatever note happens to be open next.
      if (!activeNoteId) return;
      const currentContent = latestRef.current.content;
      handleContentChange(currentContent ? `${currentContent}\n\n${text}` : text);
    },
  });

  // Shown once AUTH_FALLBACK_TIMEOUT_MS elapses with no answer to "notepad-ready" below
  // -- the genuine "actually not signed in yet" case, as opposed to the late-mount race
  // the request/response pattern itself already eliminates for the signed-in case.
  const [showSignInFallback, setShowSignInFallback] = useState(false);

  // Auth: the main window pushes a live, valid token via this event — fired once when
  // it's known to be open/opening and again on every background refresh (see App.tsx).
  // Also asks for it directly: Tauri events aren't queued for late listeners, so a
  // Notepad opened well after sign-in (the normal case) would otherwise have missed the
  // one-and-only broadcast that already happened and be stuck waiting for up to an hour,
  // until the next incidental background refresh -- even though the main window is
  // genuinely signed in the whole time. Emitting "notepad-ready" the moment this
  // listener is ready asks App.tsx to immediately re-broadcast the CURRENT token (see
  // its own "notepad-ready" responder), closing that race.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen, emit }) => {
        const subscribed = listen<NotepadAuthPayload>("notepad-auth", (event) => {
          setToken(event.payload.token);
          setShowSignInFallback(false);
        });
        emit("notepad-ready").catch(() => {
          // No Tauri context — nothing listening on the other end.
        });
        return subscribed;
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No Tauri context (e.g. this file under a test runner) — nothing to listen to.
      });
    const fallbackTimer = setTimeout(() => setShowSignInFallback(true), AUTH_FALLBACK_TIMEOUT_MS);
    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
      unlisten?.();
    };
  }, []);

  // "Sign in" fallback button (see showSignInFallback above): brings the main window to
  // front via the same show+focus Tauri command the tray's "Open Newton" menu item uses,
  // so the student can actually reach a sign-in screen instead of being stuck on a
  // dead-end waiting message.
  async function handleSignInClick() {
    try {
      await invoke("focus_main_window");
    } catch {
      // No Tauri context (e.g. under a test runner) — nothing to focus.
    }
  }

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
    // The note this recording was feeding is being closed, so its final segment has
    // nowhere it legitimately belongs — ending without transcribing is correct here,
    // rather than appending the last note's audio into whatever opens next.
    stopRecording({ discard: true });
    setTagPopoverNoteId(null);
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
      setTags(note.tags);
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
    stopRecording({ discard: true });
    setTagPopoverNoteId(null);
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
    // Typing (or an inserted annotation) replaces whatever was highlighted, so a floating
    // toolbar for the old selection would be stale.
    setSelectionToolbar(null);
    if (!activeNoteId) return;
    saveNoteDraft(activeNoteId, { title, content: value });
    scheduleSave(activeNoteId);
  }

  // Shared by BOTH the floating toolbar (handleAnnotate below) and
  // ContextMenu's right-click "Explain"/"Define"/"Summarize" (see
  // onAnnotateNoteSelection below) — one implementation of "highlight-to-act", called
  // from either trigger with whatever text was actually selected in whichever mode
  // (Write's `<textarea>` via `.selectionStart`/`.selectionEnd`, or Preview's rendered
  // `<div>` via `window.getSelection()` — see ContextMenu.tsx's "note-editable"/
  // "note-text" kinds for where that text comes from).
  async function insertAnnotation(selectedText: string, action: NoteAnnotateAction) {
    if (!activeNoteId || !token) return;
    setAnnotating(true);
    setSelectionToolbar(null);
    try {
      const currentContent = latestRef.current.content;
      const generated = await annotateNoteSelection(
        token,
        activeNoteId,
        selectedText,
        currentContent.slice(0, ANNOTATE_CONTEXT_CHARS),
        action,
      );
      const insertion = "\n\n```newton-note\n" + JSON.stringify({ action, text: generated }) + "\n```\n";
      // Insert right after the highlighted passage in the RAW markdown source. If the
      // exact selected text can't be found verbatim (e.g. it spanned rendered
      // formatting that doesn't match the raw source 1:1), fall back to appending at
      // the end rather than silently dropping the response.
      const index = currentContent.indexOf(selectedText);
      const next =
        index === -1
          ? currentContent + insertion
          : currentContent.slice(0, index + selectedText.length) +
            insertion +
            currentContent.slice(index + selectedText.length);
      handleContentChange(next);
    } catch {
      setListError("Couldn't get a response for that selection.");
    } finally {
      setAnnotating(false);
    }
  }

  async function handleAnnotate(action: NoteAnnotateAction) {
    if (!selectionToolbar) return;
    await insertAnnotation(selectionToolbar.text, action);
  }

  // ContextMenu's right-click Explain/Define/Summarize, from either the Write-mode
  // textarea or the Preview-mode rendered div (see ContextMenu.tsx's onSelect calls for
  // its "note-editable"/"note-text" kinds) — the selected text is already known at
  // call time (read from the field/window selection at right-click time), so this is a
  // thin, synchronous-looking wrapper around the same insertAnnotation used above.
  function handleContextMenuAnnotate(selectedText: string, action: NoteAnnotateAction) {
    void insertAnnotation(selectedText, action);
  }

  // ---------------------------------------------------------------------------
  // Note management (right-click on a note-picker row, ContextMenu's "note-item" kind):
  // rename (inline input) and delete (confirm, then remove).
  // ---------------------------------------------------------------------------

  function startRenameNote(noteId: string, currentTitle: string) {
    setRenamingNoteId(noteId);
    setRenameValue(currentTitle);
  }

  function cancelRenameNote() {
    setRenamingNoteId(null);
    setRenameValue("");
  }

  async function commitRenameNote(noteId: string) {
    if (!token) return;
    const newTitle = renameValue.trim();
    setRenamingNoteId(null);
    if (!newTitle) return; // Empty input: leave the existing title alone rather than blanking it.
    try {
      // PATCH /notes/{id} is a full title+content replace (see updateNote's own doc
      // comment) -- this fires from the picker, before the note is ever opened, so its
      // content isn't in memory yet and has to be fetched fresh. If it's the currently
      // open note (e.g. renamed once already open elsewhere), reuse the in-memory copy
      // instead of an extra round trip.
      const existingContent = noteId === activeNoteId ? latestRef.current.content : (await getNote(token, noteId)).content;
      await updateNote(token, noteId, newTitle, existingContent);
      if (noteId === activeNoteId) setTitle(newTitle);
      await refreshNotes();
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Couldn't rename this note.");
    }
  }

  function handleRenameKeyDown(e: ReactKeyboardEvent<HTMLInputElement>, noteId: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitRenameNote(noteId);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRenameNote();
    }
  }

  async function handleDeleteNote(noteId: string, noteTitle: string) {
    if (!token) return;
    // This codebase has no existing confirm-before-delete convention to match --
    // deleting a chat session or an uploaded document both fire immediately today (see
    // Sidebar.tsx / DocumentsPanel.tsx) -- but the product owner explicitly asked for a
    // confirmation step here, so this introduces one via the standard browser dialog
    // rather than a new bespoke modal for a single call site.
    if (!window.confirm(`Delete "${noteTitle}"? This can't be undone.`)) return;
    try {
      await deleteNote(token, noteId);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Couldn't delete this note.");
      return;
    }
    if (noteId === activeNoteId) {
      stopRecording({ discard: true });
      setTagPopoverNoteId(null);
      setActiveNoteId(null);
      setSelectionToolbar(null);
    }
    await refreshNotes();
  }

  // ---------------------------------------------------------------------------
  // Tags (small tag-icon button on a note-list row and in the open editor's header) --
  // a compact inline popover, saved immediately via PATCH /notes/{id}/tags (never the
  // debounced content autosave).
  // ---------------------------------------------------------------------------

  function openTagPopover(noteId: string, currentTags: string[]) {
    setTagPopoverNoteId(noteId);
    setTagPopoverTags(currentTags);
    setTagDraft("");
  }

  function closeTagPopover() {
    setTagPopoverNoteId(null);
    setTagDraft("");
  }

  async function commitTags(noteId: string, nextTags: string[]) {
    if (!token) return;
    try {
      const updated = await updateNoteTags(token, noteId, nextTags);
      setTagPopoverTags(updated.tags);
      setNotes((prev) => prev?.map((n) => (n.id === noteId ? { ...n, tags: updated.tags } : n)) ?? prev);
      if (noteId === activeNoteId) setTags(updated.tags);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Couldn't save these tags.");
    }
  }

  function handleAddTag() {
    const value = tagDraft.trim();
    if (!value || !tagPopoverNoteId || tagPopoverTags.includes(value)) {
      setTagDraft("");
      return;
    }
    setTagDraft("");
    void commitTags(tagPopoverNoteId, [...tagPopoverTags, value]);
  }

  function handleRemoveTag(tag: string) {
    if (!tagPopoverNoteId) return;
    void commitTags(
      tagPopoverNoteId,
      tagPopoverTags.filter((t) => t !== tag),
    );
  }

  const showPicker = activeNoteId === null;

  return (
    <div className="app-root">
      <TitleBar title="Newton Notepad" variant="notepad" />
      <div className="notepad-window">
        {!token ? (
          <div className="notepad-window__empty notepad-window__auth-wait">
            <p>Waiting for the main Newton window to sign in…</p>
            {showSignInFallback && (
              <button type="button" className="btn-primary" onClick={handleSignInClick}>
                Sign in
              </button>
            )}
          </div>
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
                  <li
                    key={note.id}
                    className="notepad-window__note-row"
                    data-context-menu="note-item"
                    data-note-id={note.id}
                    data-note-title={note.title}
                  >
                    {renamingNoteId === note.id ? (
                      <input
                        type="text"
                        className="notepad-window__note-rename-input"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => handleRenameKeyDown(e, note.id)}
                        onBlur={() => commitRenameNote(note.id)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="notepad-window__note-item"
                        onClick={() => openNote(note.id)}
                      >
                        <span className="notepad-window__note-title">{note.title}</span>
                        {tagPopoverNoteId !== note.id && note.tags.length > 0 && (
                          <span className="notepad-window__tag-pills">
                            {note.tags.map((tag) => (
                              <span key={tag} className="notepad-window__tag-pill notepad-window__tag-pill--readonly">
                                {tag}
                              </span>
                            ))}
                          </span>
                        )}
                        <span className="notepad-window__note-updated">
                          {new Date(note.updated_at).toLocaleString()}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="notepad-window__tag-icon-btn"
                      aria-label={`Tags for ${note.title}`}
                      title="Tags"
                      onClick={(e) => {
                        e.stopPropagation();
                        tagPopoverNoteId === note.id ? closeTagPopover() : openTagPopover(note.id, note.tags);
                      }}
                    >
                      🏷
                    </button>
                    {tagPopoverNoteId === note.id && (
                      <TagPopover
                        tags={tagPopoverTags}
                        draft={tagDraft}
                        onDraftChange={setTagDraft}
                        onAdd={handleAddTag}
                        onRemove={handleRemoveTag}
                        onClose={closeTagPopover}
                      />
                    )}
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
              <button
                type="button"
                className="notepad-window__tag-icon-btn"
                aria-label="Tags for this note"
                title="Tags"
                onClick={() =>
                  tagPopoverNoteId === activeNoteId ? closeTagPopover() : openTagPopover(activeNoteId!, tags)
                }
              >
                🏷
              </button>
            </div>
            {tagPopoverNoteId === activeNoteId && (
              <TagPopover
                tags={tagPopoverTags}
                draft={tagDraft}
                onDraftChange={setTagDraft}
                onAdd={handleAddTag}
                onRemove={handleRemoveTag}
                onClose={closeTagPopover}
              />
            )}
            {tagPopoverNoteId !== activeNoteId && tags.length > 0 && (
              <div className="notepad-window__tag-pills notepad-window__tag-pills--header">
                {tags.map((tag) => (
                  <span key={tag} className="notepad-window__tag-pill notepad-window__tag-pill--readonly">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="notepad-window__toolbar">
              <div className="notepad-window__toolbar-right">
                {recording ? (
                  <button type="button" className="notepad-window__record-btn notepad-window__record-btn--active" onClick={() => stopRecording()}>
                    ● {formatElapsed(recordingSeconds)} — Stop
                  </button>
                ) : (
                  <button type="button" className="notepad-window__record-btn" onClick={startRecording} title="Record lecture audio">
                    🎙 Record
                  </button>
                )}
                {transcribing && <span className="notepad-window__save-status">Transcribing…</span>}
                <span className="notepad-window__save-status">
                  {saveState === "saving" && "Saving…"}
                  {saveState === "saved" && "Saved"}
                  {saveState === "error" && "Couldn't save — kept locally"}
                </span>
              </div>
            </div>
            {recordingError && <div className="notepad-window__error">{recordingError}</div>}
            <div className="notepad-window__body">
              {loadingNote ? (
                <div className="notepad-window__empty">Loading…</div>
              ) : (
                <NoteEditor value={content} onChange={handleContentChange} onSelection={setSelectionToolbar} />
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
      <ContextMenu
        // The Notepad window has no chat sessions of its own -- this mount only ever
        // needs the note-item/note-editable/note-text kinds below; see ContextMenu.tsx's
        // module doc comment on why each real window mounts its own instance.
        onDeleteSession={() => {}}
        onRenameNote={startRenameNote}
        onDeleteNote={handleDeleteNote}
        onAnnotateNoteSelection={handleContextMenuAnnotate}
        annotateDisabled={annotating}
      />
    </div>
  );
}

/** Compact inline tags popover (list row's or editor header's small tag-icon button) --
 * existing tags as removable pills, a text input to add a new one. Deliberately not a
 * floating/absolutely-positioned overlay -- this is a small always-on-top window, and
 * an inline panel has no clipping/positioning math to get wrong. */
function TagPopover({
  tags,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  onClose,
}: {
  tags: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (tag: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="notepad-window__tag-popover" onClick={(e) => e.stopPropagation()}>
      <div className="notepad-window__tag-pills">
        {tags.length === 0 && <span className="notepad-window__tag-empty">No tags yet</span>}
        {tags.map((tag) => (
          <span key={tag} className="notepad-window__tag-pill">
            {tag}
            <button
              type="button"
              className="notepad-window__tag-remove"
              aria-label={`Remove tag ${tag}`}
              onClick={() => onRemove(tag)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="notepad-window__tag-add">
        <input
          type="text"
          className="notepad-window__tag-input"
          placeholder="Add a tag…"
          value={draft}
          autoFocus
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <button type="button" className="btn-secondary-sm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default NotepadWindow;
