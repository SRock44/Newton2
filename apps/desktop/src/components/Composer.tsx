import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { ApiError, uploadChatImage } from "../api";

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
}

const MAX_TEXTAREA_HEIGHT = 220;

function Composer({ onSend, onStop, disabled, streaming, placeholder, token, sessionId }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [attachedImage, setAttachedImage] = useState<{ id: string; name: string } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [draft]);

  // A new/switched chat has no meaning for whatever was attached to the last one.
  useEffect(() => {
    setAttachedImage(null);
    setAttachError(null);
  }, [sessionId]);

  function handleSend() {
    const trimmed = draft.trim();
    if ((!trimmed && !attachedImage) || disabled) return;
    const text = attachedImage
      ? `${trimmed}\n\n[Attached image: ${attachedImage.id}]`.trim()
      : trimmed;
    onSend(text);
    setDraft("");
    setAttachedImage(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !sessionId) return;

    setAttaching(true);
    setAttachError(null);
    try {
      const imageId = await uploadChatImage(token, sessionId, file);
      setAttachedImage({ id: imageId, name: file.name });
    } catch (err) {
      setAttachError(err instanceof ApiError ? err.message : "Couldn't attach that image.");
    } finally {
      setAttaching(false);
    }
  }

  return (
    <div className="composer">
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
      {attachError && <div className="composer-attachment-error">{attachError}</div>}
      <div className="composer-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="composer-file-input"
          onChange={handleFileSelected}
          disabled={disabled || !sessionId}
        />
        <button
          type="button"
          className="composer-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || !sessionId || attaching}
          aria-label="Attach an image"
          title="Attach a photo or screenshot"
        >
          {attaching ? "…" : "📎"}
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
            disabled={disabled || (!draft.trim() && !attachedImage)}
            aria-label="Send message"
          >
            Send
          </button>
        )}
      </div>
      <div className="composer-hint">Enter to send · Shift+Enter for a new line</div>
    </div>
  );
}

export default Composer;
