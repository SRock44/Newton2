import type { ReactNode } from "react";
import Toggle from "../../desktop/src/components/Toggle";

export interface AttachPickerDoc {
  name: string;
  date: string;
}

/** Non-interactive stand-in for the real Composer (real markup/classnames + the real
 * Toggle), showing scripted text with a frame-driven caret. The real Composer's draft
 * lives in internal state, which a frame-driven render can't set. The optional props
 * reproduce the real "+" attach menu, the "Your documents" picker, and the attachment chip
 * (all real classnames from Composer.tsx). */
export function ScriptedComposer({
  text,
  caretOn,
  placeholder,
  learnMode,
  menuOpen,
  pickerOpen,
  pickerDocs,
  attachment,
}: {
  text: string;
  caretOn: boolean;
  placeholder?: string;
  learnMode?: boolean;
  menuOpen?: boolean;
  pickerOpen?: boolean;
  pickerDocs?: AttachPickerDoc[];
  attachment?: string | null;
}) {
  return (
    <div className="composer">
      <div className="composer-controls">
        <div className="composer-learn-mode-toggle" data-promo="learn">
          <Toggle checked={!!learnMode} onChange={() => {}} label="Learn Mode" size="sm" emphasized={!!learnMode} />
          <span>Learn Mode</span>
        </div>
        <div className="composer-conversation-practice-toggle">
          <Toggle checked={false} onChange={() => {}} label="Conversation Practice" size="sm" />
          <span>Conversation Practice</span>
        </div>
      </div>
      {attachment && (
        <div className="composer-attachments">
          <div className="composer-attachment">
            <span className="composer-attachment-name">📄 {attachment}</span>
            <button type="button" className="composer-attachment-remove" tabIndex={-1}>
              ×
            </button>
          </div>
        </div>
      )}
      <div className="composer-row">
        <div className="composer-attach-wrap">
          <button type="button" className="composer-attach" data-promo="plus" tabIndex={-1}>
            +
          </button>
          {menuOpen && (
            <div className="composer-attach-menu" role="menu">
              <button type="button" role="menuitem" className="composer-attach-menu-item" data-promo="menu-upload">
                Upload from your computer
              </button>
              <button type="button" role="menuitem" className="composer-attach-menu-item" data-promo="menu-existing">
                Attach an existing document
              </button>
            </div>
          )}
          {pickerOpen && (
            <div className="composer-document-picker" role="menu" aria-label="Attach an existing document">
              <div className="composer-document-picker-header">Your documents</div>
              {(pickerDocs ?? []).map((d, i) => (
                <button
                  key={d.name}
                  type="button"
                  role="menuitem"
                  className="composer-document-picker-item"
                  data-promo={i === 0 ? "picker-deck" : `picker-${i}`}
                >
                  <span className="composer-document-picker-name">{d.name}</span>
                  <span className="composer-document-picker-date">{d.date}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="composer-mic" tabIndex={-1}>
          🎙
        </button>
        <div className="composer-input promo-typed" data-promo="composer">
          {text}
          <span className="promo-caret" style={{ opacity: caretOn ? 1 : 0 }} />
          {!text && placeholder && <span style={{ color: "var(--color-text-faint)", marginLeft: 2 }}>{placeholder}</span>}
        </div>
        <button type="button" className="btn-primary composer-send" data-promo="send" tabIndex={-1}>
          Send
        </button>
      </div>
      <div className="composer-hint">Enter to send · Shift+Enter for a new line</div>
    </div>
  );
}

export function Caption({ children, opacity }: { children: ReactNode; opacity: number }) {
  return (
    <div className="promo-caption" style={{ opacity, transform: `translateX(-50%) translateY(${(1 - opacity) * 10}px)` }}>
      {children}
    </div>
  );
}

export function CursorArrow() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <path
        d="M4 2 L4 19 L8.5 15.2 L11.3 21.5 L14 20.3 L11.2 14 L17 14 Z"
        fill="#1a1a1a"
        stroke="#fff"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
