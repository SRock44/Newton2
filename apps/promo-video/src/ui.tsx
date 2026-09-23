import type { ReactNode } from "react";
import Toggle from "../../desktop/src/components/Toggle";

export interface AttachPickerDoc {
  name: string;
  date: string;
}

// The app uses emoji (a microphone, a page) for these two glyphs. A headless renderer has no colour
// emoji font and draws them as a tiny smudge, so the film draws the same two symbols as SVG.
function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-2px" }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
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
  attachments,
}: {
  text: string;
  caretOn: boolean;
  placeholder?: string;
  learnMode?: boolean;
  menuOpen?: boolean;
  pickerOpen?: boolean;
  pickerDocs?: AttachPickerDoc[];
  attachment?: string | null;
  /** several attached documents (the real composer keeps a list); wins over `attachment` */
  attachments?: string[];
}) {
  const chips = attachments ?? (attachment ? [attachment] : []);
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
      {chips.length > 0 && (
        <div className="composer-attachments">
          {chips.map((name) => (
            <div className="composer-attachment" key={name}>
              <span className="composer-attachment-name">
                <DocIcon /> {name}
              </span>
              <button type="button" className="composer-attachment-remove" tabIndex={-1}>
                ×
              </button>
            </div>
          ))}
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
              {(pickerDocs ?? []).map((d, i) => {
                const attached = chips.includes(d.name);
                return (
                  <button
                    key={d.name}
                    type="button"
                    role="menuitem"
                    className={`composer-document-picker-item${attached ? " composer-document-picker-item--attached" : ""}`}
                    data-promo={i === 0 ? "picker-deck" : `picker-${i}`}
                  >
                    <span className="composer-document-picker-name">{d.name}</span>
                    <span className="composer-document-picker-date">{attached ? "✓ Attached" : d.date}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button type="button" className="composer-mic" tabIndex={-1}>
          <MicIcon />
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
