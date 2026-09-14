import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { ApiError, listDocuments, uploadChatImage, uploadDocument } from "../api";
import type { UploadedDocument } from "../types";

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
}

const MAX_TEXTAREA_HEIGHT = 220;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
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
  },
  ref,
) {
  const [draft, setDraft] = useState("");
  const [attachedImage, setAttachedImage] = useState<{ id: string; name: string } | null>(null);
  const [attachedDocument, setAttachedDocument] = useState<{ id: string; name: string } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

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

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

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
  }, [sessionId]);

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

  function handleSend() {
    const trimmed = draft.trim();
    if ((!trimmed && !attachedImage && !attachedDocument) || disabled) return;
    let text = trimmed;
    if (attachedImage) text = `${text}\n\n[Attached image: ${attachedImage.id}]`.trim();
    if (attachedDocument) {
      text = `${text}\n\n[Attached document: ${attachedDocument.id}|${attachedDocument.name}]`.trim();
    }
    onSend(text);
    setDraft("");
    setAttachedImage(null);
    setAttachedDocument(null);
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
    <div className="composer">
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
            aria-label="Send message"
          >
            Send
          </button>
        )}
      </div>
      <div className="composer-hint">Enter to send · Shift+Enter for a new line</div>
    </div>
  );
});

export default Composer;
