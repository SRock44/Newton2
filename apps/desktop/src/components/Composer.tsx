import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface ComposerProps {
  onSend: (text: string) => void;
  disabled: boolean;
  placeholder?: string;
}

const MAX_TEXTAREA_HEIGHT = 220;

function Composer({ onSend, disabled, placeholder }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [draft]);

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={textareaRef}
        className="composer-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Newton is responding…" : placeholder ?? "Ask Newton anything… (Enter to send, Shift+Enter for a new line)"}
        disabled={disabled}
        rows={1}
      />
      <button
        type="button"
        className="composer-send"
        onClick={handleSend}
        disabled={disabled || !draft.trim()}
        aria-label="Send message"
      >
        Send
      </button>
    </div>
  );
}

export default Composer;
