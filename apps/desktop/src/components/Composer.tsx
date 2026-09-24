import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { ApiError, getBillingStatus, listDocuments, setLearnMode, uploadChatImage, uploadDocument } from "../api";
import type { UploadedDocument } from "../types";
import { useVoiceRecorder } from "../lib/useVoiceRecorder";
import Toggle from "./Toggle";

/** Conversation Practice mode (turn-based spoken roleplay -- see
 * app/agents/tutor.py's conversation_practice_addendum and services/piper-tts's
 * multi-language voices): the languages this app can both (a) ask the tutor to
 * roleplay in and (b) actually play back in a matching voice, kept as one list since
 * offering a language Piper has no voice for would just mean an honest-but-confusing
 * silent fallback to English audio under a Spanish/French conversation. Mirrors
 * services/piper-tts/app/main.py's VOICE_MODELS keys exactly. */
export const CONVERSATION_PRACTICE_LANGUAGES: { code: string; label: string }[] = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "en", label: "English" },
];

/** Options threaded through onSend only for a Conversation Practice turn -- absent
 * (undefined) for every ordinary chat message, which is what keeps ordinary chat
 * completely unaffected by this feature (see app/agents/tutor.py's own regression
 * test). */
export interface ConversationPracticeOptions {
  conversationPractice: true;
  targetLanguage: string;
}

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
  /** `options` is only ever present for a Conversation Practice send (see
   * ConversationPracticeOptions) -- every other call site (a plain typed/dictated
   * message, an "options"-picker/paper-plan-approval auto-send from MessageContent,
   * the attached-image auto-send) calls this with just `text`, unaffected. */
  onSend: (text: string, options?: ConversationPracticeOptions) => void;
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
  /** DocumentViewerPanel's "Ask Newton" on a highlighted excerpt (see App.tsx's
   * handleAskAboutDocumentSelection): quotes the excerpt into the draft and focuses the
   * composer, same "set it, don't send it" contract as pendingAttachment above — the
   * student still writes and sends their own instruction. */
  pendingDraftText?: string | null;
  /** Called once the pending draft above has actually been applied — see
   * onPendingAttachmentConsumed. */
  onPendingDraftConsumed?: () => void;
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
    pendingDraftText,
    onPendingDraftConsumed,
    editing,
    onCancelEdit,
    editError,
  },
  ref,
) {
  const [draft, setDraft] = useState("");
  const [attachedImage, setAttachedImage] = useState<{ id: string; name: string } | null>(null);
  // Several documents can ride along on one message (e.g. lab notes AND a project synopsis for a
  // paper), each tagged with its own "[Attached document: ...]" marker on send.
  const [attachedDocuments, setAttachedDocuments] = useState<{ id: string; name: string }[]>([]);
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

  // Conversation Practice mode (turn-based spoken roleplay, distinct from ordinary
  // chat -- see app/agents/tutor.py's conversation_practice_addendum). Deliberately
  // client-only, per-turn, NEVER persisted server-side like Learn Mode above: this is
  // "practice a spoken exchange right now," not a standing account preference, and
  // resets with everything else when the student switches chats (see the
  // session-switch effect below). Defaults to Spanish (the first non-English option)
  // since picking a language to practice IS the point of turning this on.
  const [conversationPracticeEnabled, setConversationPracticeEnabled] = useState(false);
  const [conversationPracticeLanguage, setConversationPracticeLanguage] = useState(
    CONVERSATION_PRACTICE_LANGUAGES[0]!.code,
  );

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
    setAttachedDocuments([]);
    setAttachError(null);
    setMenuOpen(false);
    setPickerOpen(false);
    // Conversation Practice is per-turn/per-chat, not a standing preference (see its
    // own state declaration above) -- a new/switched chat starts back in ordinary
    // chat mode, never carrying over a practice language from whatever chat was open
    // before.
    setConversationPracticeEnabled(false);
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
    addAttachedDocument({ id: pendingAttachment.id, name: pendingAttachment.name });
    onPendingAttachmentConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAttachment]);

  // DocumentViewerPanel's "Ask Newton" (App.tsx's handleAskAboutDocumentSelection) —
  // same shape as the attachment effect above, just setting the draft text instead.
  useEffect(() => {
    if (!pendingDraftText) return;
    setDraft(pendingDraftText);
    onPendingDraftConsumed?.();
    textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDraftText]);

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
    if ((!trimmed && !attachedImage && attachedDocuments.length === 0) || disabled) return;
    let text = trimmed;
    if (attachedImage) text = `${text}\n\n[Attached image: ${attachedImage.id}]`.trim();
    if (attachedDocuments.length > 0) {
      const markers = attachedDocuments.map((d) => `[Attached document: ${d.id}|${d.name}]`).join("\n");
      text = `${text}\n\n${markers}`.trim();
    }
    // Same onSend call either way — App.tsx's handleSend itself checks whether an edit
    // is in progress and, if so, deletes-and-truncates before resending. No parallel
    // send mechanism here; editing is indistinguishable from a brand new message once
    // that truncation has happened.
    // Omits the 2nd arg entirely (rather than passing `undefined` positionally) for
    // an ordinary send, so every existing caller's onSend(text) contract -- and every
    // test asserting a single-argument call -- stays completely unchanged.
    if (conversationPracticeEnabled) {
      onSend(text, { conversationPractice: true, targetLanguage: conversationPracticeLanguage });
    } else {
      onSend(text);
    }
    setDraft("");
    setAttachedImage(null);
    setAttachedDocuments([]);
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
        addAttachedDocument({ id: doc.id, name: doc.filename });
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

  function addAttachedDocument(doc: { id: string; name: string }) {
    setAttachedDocuments((prev) => (prev.some((d) => d.id === doc.id) ? prev : [...prev, doc]));
  }

  // Picking adds to what is already attached (open "+" again for the next one); picking a
  // document that is already attached detaches it.
  function selectExistingDocument(doc: UploadedDocument) {
    if (attachedDocuments.some((d) => d.id === doc.id)) {
      setAttachedDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } else {
      addAttachedDocument({ id: doc.id, name: doc.filename });
    }
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
        {/* Conversation Practice: a turn-based spoken roleplay mode, distinct from
            ordinary chat (see app/agents/tutor.py's conversation_practice_addendum).
            Turning it on tags the NEXT sent message so the tutor replies briefly, in
            the chosen language, roleplaying a spoken scenario -- and (see
            MessageBubble.tsx's ListenButton autoPlay prop) automatically speaks that
            reply back once it finishes, no manual "Listen" click needed. Still
            explicitly turn-based/push-to-talk: dictate with the mic button above,
            review/edit the transcript like normal, then Send. */}
        <div
          className="composer-conversation-practice-toggle"
          title="Newton replies briefly, in the chosen language, roleplaying a spoken scenario -- and reads its reply back automatically"
        >
          <Toggle
            checked={conversationPracticeEnabled}
            onChange={setConversationPracticeEnabled}
            label="Conversation Practice"
            size="sm"
            emphasized={conversationPracticeEnabled}
          />
          <span>Conversation Practice</span>
          {conversationPracticeEnabled && (
            <select
              className="composer-conversation-practice-language"
              value={conversationPracticeLanguage}
              onChange={(e) => setConversationPracticeLanguage(e.target.value)}
              aria-label="Language to practice"
            >
              {CONVERSATION_PRACTICE_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {(attachedImage || attachedDocuments.length > 0) && (
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
          {attachedDocuments.map((doc) => (
            <div className="composer-attachment" key={doc.id}>
              <span className="composer-attachment-name">📄 {doc.name}</span>
              <button
                type="button"
                className="composer-attachment-remove"
                onClick={() => setAttachedDocuments((prev) => prev.filter((d) => d.id !== doc.id))}
                aria-label={attachedDocuments.length > 1 ? `Remove attached document ${doc.name}` : "Remove attached document"}
              >
                ×
              </button>
            </div>
          ))}
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
                pickerDocuments?.map((doc) => {
                  const attached = attachedDocuments.some((d) => d.id === doc.id);
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      role="menuitem"
                      className={`composer-document-picker-item${attached ? " composer-document-picker-item--attached" : ""}`}
                      onClick={() => selectExistingDocument(doc)}
                    >
                      <span className="composer-document-picker-name">{doc.filename}</span>
                      <span className="composer-document-picker-date">
                        {attached ? "✓ Attached" : formatDate(doc.created_at)}
                      </span>
                    </button>
                  );
                })
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
            disabled={disabled || (!draft.trim() && !attachedImage && attachedDocuments.length === 0)}
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
