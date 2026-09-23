import type { ReactNode } from "react";
import Toggle from "../../desktop/src/components/Toggle";

/** Non-interactive stand-in for the real Composer (real markup/classnames + the real
 * Toggle), showing scripted text with a frame-driven caret. The real Composer's draft
 * lives in internal state, which a frame-driven render can't set. */
export function ScriptedComposer({ text, caretOn }: { text: string; caretOn: boolean }) {
  return (
    <div className="composer">
      <div className="composer-controls">
        <div className="composer-learn-mode-toggle">
          <Toggle checked={false} onChange={() => {}} label="Learn Mode" size="sm" />
          <span>Learn Mode</span>
        </div>
        <div className="composer-conversation-practice-toggle">
          <Toggle checked={false} onChange={() => {}} label="Conversation Practice" size="sm" />
          <span>Conversation Practice</span>
        </div>
      </div>
      <div className="composer-row">
        <div className="composer-attach-wrap">
          <button type="button" className="composer-attach" tabIndex={-1}>
            +
          </button>
        </div>
        <button type="button" className="composer-mic" tabIndex={-1}>
          🎙
        </button>
        <div className="composer-input promo-typed" data-promo="composer">
          {text}
          <span className="promo-caret" style={{ opacity: caretOn ? 1 : 0 }} />
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
