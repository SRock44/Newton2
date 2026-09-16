import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { ApiError, getBillingStatus, listDocuments, setLearnMode, uploadChatImage, uploadDocument } from "../api";
import type { UploadedDocument } from "../types";
import { useVoiceRecorder } from "../lib/useVoiceRecorder";
import Toggle from "./Toggle";

/** Imperative handle exposed via ref — currently just `focus()`, used by
 * PaperPlanCard's "Request Changes" action (see App.tsx's handleFocusComposer) to put
 * the cursor in the composer so the student can type their own tweaks, without sending
 * anything on their behalf. Kept as a tiny imperative escape hatch rather than more
 * prop-drilled state, since "focus this input" has no other meaningful representation
 * as data. */
export interface ComposerHandle {
  focus: () => void;
}

interface ComposerProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled: boolean;
  /** True specifically while a reply is being generated — distinct from `disabled`,
   * which is also true with no active session. Only this shows the Stop button. */
  streaming?: boolean;
  placeholder?: string;
  token: string;
  sessionId: string | null;
  /** A document to pre-attach the moment this exact session is active — set by
   * App.tsx's "Chat about this document" flow (DocumentsPanel), already scoped to the
   * right session before it ever reaches here. Applied via the *same* setAttachedDocument
   * path a manual "+" -> "Attach an existing document" pick would use, so the two
   * interactions end in an identical state — nothing is sent on the student's behalf. */
  pendingAttachment?: { id: string; name: string } | null;
  /** Called once the pending attachment above has actually been applied, so the parent
   * can clear it and never re-apply it (e.g. if the student then removes the chip). */
  onPendingAttachmentConsumed?: () => void;
  /** Message editing (ROADMAP.md): non-null while the student is editing a previous
   * message of their own — set by App.tsx's handleEditMessage (via the context menu's
   * "Edit message"), cleared on cancel or once the edit is actually sent. Repopulates
   * the draft with that message's exact original text (see the effect below) and shows
   * a visible "Editing message" indicator with a way to back out. `content` is the
   * message's raw original text (same string "Copy message" copies), not the
   * attachment-stripped display text. */
  editing?: { id: string; content: string } | null;
  /** Backs out of edit mode without sending anything — the original message and the
   * rest of the conversation stay exactly as they were. */
  onCancelEdit?: () => void;
  /** Set by App.tsx if the edit's delete-and-truncate call fails — shown inline next to
   * the editing indicator so the student knows to retry or cancel, same
   * fail-loud-but-leave-everything-untouched spirit as this app's other destructive
   * actions (e.g. SettingsPanel's delete-account confirmation). */
  editError?: string | null;
}

const MAX_TEXTAREA_HEIGHT = 220;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/** m:ss for the live dictation readout — same shape as the Notepad's recording clock. */
function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    onSend,
    onStop,
    disabled,
    streaming,
    placeholder,
    token,
    sessionId,
    pendingAttachment,
    onPendingAttachmentConsumed,
    editing,
    onCancelEdit,
    editError,
  },
  ref,
) {
  const [draft, setDraft] = useState("");
  const [attachedImage, setAttachedImage] = useState<{ id: string; name: string } | null>(null);
  const [attachedDocument, setAttachedDocument] = useState<{ id: string; name: string } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Learn Mode's PRIMARY toggle control -- visible and switchable directly in the chat
  // interface (not buried in Settings, though SettingsPanel.tsx mirrors it there too
  // for discoverability), since some students just want Newton as a regular chatbot
  // and shouldn't have to leave the conversation to turn interactive teaching on or
  // off. Fetches its own billing status independently on mount, same pattern as
  // DocumentsPanel.tsx's generation-target note and SettingsPanel.tsx itself -- this
  // app has no shared billing-status context, each component that needs it loads its
  // own. `learnModeLoaded` gates the checkbox until the real server value is known, so
  // it never flashes an incorrect default before the fetch resolves.
  const [learnModeEnabled, setLearnModeEnabled] = useState(false);
  const [learnModeLoaded, setLearnModeLoaded] = useState(false);
  const [savingLearnMode, setSavingLearnMode] = useState(false);
  const [learnModeError, setLearnModeError] = useState<string | null>(null);

  // The "+" button's own small popover menu ("Upload from your computer" / "Attach an
  // existing document" — see the composer-attach-menu/-document-picker CSS) and, once
  // "Attach an existing document" is picked, the quick listDocuments-backed picker
  // itself. Documents are fetched lazily, once, the first time the picker opens.
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDocuments, setPickerDocuments] = useState<UploadedDocument[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachWrapRef = useRef<HTMLDivElement>(null);
  // Where to put the caret after a transcription has been spliced into the draft —
  // applied in an effect below, since the new value isn't in the DOM yet at the moment
  // we work out where the caret should land.
  const pendingCaretRef = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  /** Dictation: the same recorder mechanics the Notepad's lecture capture already uses
   * (see lib/useVoiceRecorder.ts), minus the segmenting — a chat message is short, so
   * it's one recording transcribed once when the student stops, rather than arriving in
   * pieces that would fragment the draft mid-sentence. The text lands in the composer
   * for the student to read and edit; nothing is ever sent on their behalf. */
  const {
    recording,
    transcribing,
    elapsedSeconds,
    error: voiceError,
    clearError: clearVoiceError,
    start: startRecording,
    stop: stopRecording,
  } = useVoiceRecorder({
    token,
    onTranscript: (text) => insertAtCursor(text),
  });

  /** Splices transcribed text in at the caret (replacing any selection), rather than
   * always appending — a student who dictates mid-sentence gets the words where they
   * were actually looking. Falls back to the end of the draft when there's no live
   * selection to read (e.g. the textarea never had focus this session). */
  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    const rawStart = el?.selectionStart;
    const rawEnd = el?.selectionEnd;
    const start = typeof rawStart === "number" ? Math.min(rawStart, draft.length) : draft.length;
    const end = typeof rawEnd === "number" ? Math.max(start, Math.min(rawEnd, draft.length)) : start;
    const before = draft.slice(0, start);
    const after = draft.slice(end);
    // Don't jam dictated words up against existing text on either side.
    const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
    const trail = after.length > 0 && !/^\s/.test(after) ? " " : "";
    const insertion = `${lead}${text}${trail}`;
    pendingCaretRef.current = before.length + lead.length + text.length;
    setDraft(before + insertion + after);
  }

  // Restore the caret (and focus) right after a transcription lands, so the student can
  // simply keep typing from where the dictated text ended.
  useEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    setLearnModeLoaded(false);
    getBillingStatus(token)
      .then((status) => {
        if (!cancelled) setLearnModeEnabled(status.learn_mode_enabled);
      })
      .catch(() => {
        // A failed fetch just leaves the toggle at its last-known (or default-off)
        // state -- same "quietly degrade, never block chatting" reasoning as every
        // other optional-preference fetch in this app.
      })
      .finally(() => {
        if (!cancelled) setLearnModeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [draft]);

  // A new/switched chat has no meaning for whatever was attached to (or being picked
  // for) the last one.
  useEffect(() => {
    setAttachedImage(null);
    setAttachedDocument(null);
    setAttachError(null);
    setMenuOpen(false);
    setPickerOpen(false);
    // A recording started for the last chat has no meaning for this one: release the
    // mic AND drop what it captured, rather than landing the previous conversation's
    // half-sentence in this one's draft.
    stopRecording({ discard: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Message editing (ROADMAP.md): the moment a new edit target is set (id changes from
  // null/a different message to this one), repopulate the draft with that message's
  // exact original text — not appended, a full replace — so the student sees and can
  // further tweak their exact original wording. Deliberately keyed on `editing?.id`
  // alone (not `editing` itself, and not `draft`): re-running this on every keystroke
  // would stomp the student's in-progress tweaks back to the original text.
  useEffect(() => {
    if (editing) setDraft(editing.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  // "Chat about this document" (App.tsx) hands off a document to pre-attach here the
  // same way manually picking it from the "+" menu would — runs after the reset above
  // for the same session-switch, so it lands as the final state rather than being
  // immediately cleared by it.
  useEffect(() => {
    if (!pendingAttachment) return;
    setAttachedDocument({ id: pendingAttachment.id, name: pendingAttachment.name });
    onPendingAttachmentConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAttachment]);

  // Close either popover on an outside click or Escape — same idea as ContextMenu.tsx's
  // dismiss handling, just scoped to this one anchored wrapper instead of the whole
  // document's right-click menu.
  useEffect(() => {
    if (!menuOpen && !pickerOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (attachWrapRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
      setPickerOpen(false);
    }
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, pickerOpen]);

  /** Same optimistic-update-then-reconcile-on-failure pattern as SettingsPanel.tsx's
   * handleToggleFocusMode: flips the checkbox immediately, persists in the background,
   * and reverts (with an inline error) if the save actually fails, rather than leaving
   * the UI showing a state that never took. */
  async function handleToggleLearnMode(enabled: boolean) {
    if (savingLearnMode) return;
    const previous = learnModeEnabled;
    setLearnModeEnabled(enabled);
    setSavingLearnMode(true);
    setLearnModeError(null);
    try {
      const status = await setLearnMode(token, enabled);
      setLearnModeEnabled(status.learn_mode_enabled);
    } catch (err) {
      setLearnModeEnabled(previous);
      setLearnModeError(err instanceof ApiError ? err.message : "Couldn't save your Learn Mode setting.");
    } finally {
      setSavingLearnMode(false);
    }
  }

  function handleSend() {
    const trimmed = draft.trim();
    if ((!trimmed && !attachedImage && !attachedDocument) || disabled) return;
    let text = trimmed;
    if (attachedImage) text = `${text}\n\n[Attached image: ${attachedImage.id}]`.trim();
    if (attachedDocument) {
      text = `${text}\n\n[Attached document: ${attachedDocument.id}|${attachedDocument.name}]`.trim();
    }
    // Same onSend call either way — App.tsx's handleSend itself checks whether an edit
    // is in progress and, if so, deletes-and-truncates before resending. No parallel
    // send mechanism here; editing is indistinguishable from a brand new message once
    // that truncation has happened.
    onSend(text);
    setDraft("");
    setAttachedImage(null);
    setAttachedDocument(null);
  }

  function handleCancelEdit() {
    setDraft("");
    onCancelEdit?.();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // A file picked via "Upload from your computer" — images stay the existing ephemeral
  // vision-attachment flow (uploadChatImage, "[Attached image: <id>]"); anything else
  // (.txt/.md/.pdf) goes through the real, permanent document-upload endpoint instead
  // and gets tagged with the new document marker (see MessageBubble's
  // AttachedDocumentChip for how that renders).
  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !sessionId) return;

    setAttaching(true);
    setAttachError(null);
    try {
      if (file.type.startsWith("image/")) {
        const imageId = await uploadChatImage(token, sessionId, file);
        setAttachedImage({ id: imageId, name: file.name });
      } else {
        const doc = await uploadDocument(token, file);
        setAttachedDocument({ id: doc.id, name: doc.filename });
      }
    } catch (err) {
      setAttachError(err instanceof ApiError ? err.message : `Couldn't attach ${file.name}.`);
    } finally {
      setAttaching(false);
    }
  }

  function handleUploadMenuItem() {
    setMenuOpen(false);
    fileInputRef.current?.click();
  }

  async function handleExistingDocumentMenuItem() {
    setMenuOpen(false);
    setPickerOpen(true);
    if (pickerDocuments !== null) return;
    setPickerLoading(true);
    setPickerError(null);
    try {
      setPickerDocuments(await listDocuments(token));
    } catch (err) {
      setPickerError(err instanceof ApiError ? err.message : "Couldn't load your documents.");
    } finally {
      setPickerLoading(false);
    }
  }

  function selectExistingDocument(doc: UploadedDocument) {
    setAttachedDocument({ id: doc.id, name: doc.filename });
    setPickerOpen(false);
  }

  return (
    <div className={`composer${editing ? " composer--editing" : ""}`}>
      {editing && (
        <div className="composer-editing-banner" role="status">
          <span className="composer-editing-label">Editing message</span>
          {editError && <span className="composer-editing-error">{editError}</span>}
          <button type="button" className="composer-editing-cancel" onClick={handleCancelEdit}>
            Cancel
          </button>
        </div>
      )}
      <div className="composer-controls">
        <div
          className="composer-learn-mode-toggle"
          title="Newton checks your work step by step and asks you to try things yourself"
        >
          <Toggle
            checked={learnModeEnabled}
            onChange={handleToggleLearnMode}
            disabled={!learnModeLoaded || savingLearnMode}
            label="Learn Mode"
            size="sm"
            emphasized={learnModeEnabled}
          />
          <span>Learn Mode</span>
        </div>
        {learnModeError && <span className="composer-learn-mode-error">{learnModeError}</span>}
      </div>
      {(attachedImage || attachedDocument) && (
        <div className="composer-attachments">
          {attachedImage && (
            <div className="composer-attachment">
              <span className="composer-attachment-name">🖼 {attachedImage.name}</span>
              <button
                type="button"
                className="composer-attachment-remove"
                onClick={() => setAttachedImage(null)}
                aria-label="Remove attached image"
              >
                ×
              </button>
            </div>
          )}
          {attachedDocument && (
            <div className="composer-attachment">
              <span className="composer-attachment-name">📄 {attachedDocument.name}</span>
              <button
                type="button"
                className="composer-attachment-remove"
                onClick={() => setAttachedDocument(null)}
                aria-label="Remove attached document"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}
      {attachError && <div className="composer-attachment-error">{attachError}</div>}
      {/* Dictation's own errors are kept separate from attachment errors and are
          dismissible: the most likely one is the Pro gate on /voice/transcribe, which is
          a plan message to read and move on from, not a failure to retry. Same honest,
          non-punitive framing as DocumentsPanel's free-plan generation note — the
          server's own wording, shown as-is. */}
      {voiceError && (
        <div className="composer-voice-error" role="status">
          <span>{voiceError}</span>
          <button type="button" className="composer-voice-error-dismiss" onClick={clearVoiceError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <div className="composer-row">
        <div className="composer-attach-wrap" ref={attachWrapRef}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.pdf,text/plain,text/markdown,application/pdf"
            className="composer-file-input"
            onChange={handleFileSelected}
            disabled={disabled || !sessionId}
          />
          <button
            type="button"
            className="composer-attach"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={disabled || !sessionId || attaching}
            aria-label="Add attachment"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="Attach a photo, screenshot, or document"
          >
            {attaching ? "…" : "+"}
          </button>

          {menuOpen && (
            <div className="composer-attach-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="composer-attach-menu-item"
                onClick={handleUploadMenuItem}
              >
                Upload from your computer
              </button>
              <button
                type="button"
                role="menuitem"
                className="composer-attach-menu-item"
                onClick={handleExistingDocumentMenuItem}
              >
                Attach an existing document
              </button>
            </div>
          )}

          {pickerOpen && (
            <div className="composer-document-picker" role="menu" aria-label="Attach an existing document">
              <div className="composer-document-picker-header">Your documents</div>
              {pickerLoading ? (
                <p className="empty-state-text">Loading…</p>
              ) : pickerError ? (
                <div className="banner banner--error">{pickerError}</div>
              ) : pickerDocuments && pickerDocuments.length === 0 ? (
                <p className="empty-state-text">No documents yet.</p>
              ) : (
                pickerDocuments?.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    role="menuitem"
                    className="composer-document-picker-item"
                    onClick={() => selectExistingDocument(doc)}
                  >
                    <span className="composer-document-picker-name">{doc.filename}</span>
                    <span className="composer-document-picker-date">{formatDate(doc.created_at)}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {/* Dictation. One button, two states — click to start, click again to stop and
            transcribe — mirroring the Notepad's Record/Stop control rather than a
            press-and-hold, which is awkward for anything longer than a few words. */}
        <button
          type="button"
          className={`composer-mic${recording ? " composer-mic--recording" : ""}`}
          onClick={() => (recording ? stopRecording() : void startRecording())}
          disabled={disabled || transcribing}
          aria-pressed={recording}
          aria-label={recording ? "Stop recording and transcribe" : "Dictate a message"}
          title={recording ? "Stop recording and add what you said to the message" : "Speak your message instead of typing"}
        >
          {recording ? (
            <>
              <span className="composer-mic-dot" aria-hidden="true" />
              {formatElapsed(elapsedSeconds)}
            </>
          ) : transcribing ? (
            "…"
          ) : (
            <span aria-hidden="true">🎙</span>
          )}
        </button>
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Newton is responding…" : placeholder ?? "Ask Newton anything…"}
          disabled={disabled}
          rows={1}
          data-context-menu="editable"
        />
        {streaming ? (
          <button
            type="button"
            className="btn-primary composer-stop"
            onClick={onStop}
            aria-label="Stop generating"
            title="Stop Newton's reply"
          >
            <span className="composer-stop-icon" aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary composer-send"
            onClick={handleSend}
            disabled={disabled || (!draft.trim() && !attachedImage && !attachedDocument)}
            aria-label={editing ? "Save edit" : "Send message"}
          >
            {editing ? "Save edit" : "Send"}
          </button>
        )}
      </div>
      <div className="composer-hint">Enter to send · Shift+Enter for a new line</div>
    </div>
  );
});

export default Composer;
