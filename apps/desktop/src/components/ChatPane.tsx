import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import MessageBubble from "./MessageBubble";
import NewtonMark from "./NewtonMark";
import OnboardingWelcome from "./OnboardingWelcome";
import { latestPaperPlanMessageIndex } from "../lib/paperPlanIndex";
import { isAnswerToInteractiveBlock } from "../lib/interactiveAnswers";

interface ChatPaneProps {
  messages: ChatMessage[];
  loading: boolean;
  loadError: string | null;
  token: string;
  sessionId: string | null;
  onOpenSuggestedPanel: (panel: string) => void;
  onOpenDocument: (documentId: string) => void;
  /** Sends a plain-text chat message on the student's behalf — for an "options" pick or
   * a "paper-plan" approval (see MessageBubble/MessageContent/CodeBlock). Optional so
   * existing call sites/tests that never render one of those blocks don't need it. */
  onSend?: (text: string) => void;
  /** Focuses the composer — for "paper-plan"'s "Request Changes" action. */
  onFocusComposer?: () => void;
  /** True only for a brand-new account that hasn't dismissed (or acted on) the
   * first-run welcome card yet — see App.tsx/lib/onboarding.ts. Only takes effect on an
   * actually-empty chat (see the render below): a returning student who happens to open
   * a fresh empty session never sees this replayed. */
  firstRun?: boolean;
  /** Marks the welcome card seen and hides it for good — see OnboardingWelcome.tsx. */
  onDismissFirstRun?: () => void;
  /** Message editing (ROADMAP.md): the id of the one message currently being edited, if
   * any (see App.tsx's editingMessage state) — threaded down to MessageBubble for a
   * subtle highlight distinct from the composer's own "Editing message" indicator. */
  editingMessageId?: string | null;
}

function ChatPane({
  messages,
  loading,
  loadError,
  token,
  sessionId,
  onOpenSuggestedPanel,
  onOpenDocument,
  onSend,
  onFocusComposer,
  firstRun,
  onDismissFirstRun,
  editingMessageId,
}: ChatPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Which single message (if any) holds the most recent ```paper-plan block across the
  // whole visible history — only its card gets to show live Approve/Request Changes
  // buttons; any earlier plan renders read-only. Recomputed each render (cheap: a plain
  // string scan over messages already in memory), not memoized, since it must always
  // reflect the exact `messages` this render is showing.
  const latestPaperPlanIndex = latestPaperPlanMessageIndex(messages);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="chat-pane" ref={containerRef}>
      {loadError && <div className="banner banner--error chat-pane-banner">{loadError}</div>}

      {loading && messages.length === 0 && !loadError && (
        <div className="chat-empty-state">
          <p>Loading conversation…</p>
        </div>
      )}

      {!loading && messages.length === 0 && !loadError && firstRun && onSend && onDismissFirstRun && (
        <OnboardingWelcome onSend={onSend} onDismiss={onDismissFirstRun} />
      )}

      {!loading && messages.length === 0 && !loadError && !(firstRun && onSend && onDismissFirstRun) && (
        <div className="chat-empty-state">
          <div className="chat-empty-state-mark">
            <NewtonMark size={26} />
          </div>
          <h2>Ask Newton anything</h2>
          <p className="font-voice">
            Start the conversation below — questions, explanations, problem sets, whatever you're
            studying.
          </p>
        </div>
      )}

      <div className="message-list" data-testid="message-list">
        {messages.map((message, index) => {
          // A student's answer to an options/paper-plan/step-check/checkpoint card is
          // sent as a real chat message (so the model sees it), but that same card
          // already shows it inline, read-only, once it lands (see isAnswerToInteractive
          // Block's own comment) — rendering it again here as an ordinary bubble would
          // just be a visible duplicate of text already on screen.
          if (isAnswerToInteractiveBlock(messages, index)) return null;
          return (
            <MessageBubble
              key={index}
              message={message}
              token={token}
              sessionId={sessionId}
              onOpenSuggestedPanel={onOpenSuggestedPanel}
              onOpenDocument={onOpenDocument}
              onSend={onSend}
              onFocusComposer={onFocusComposer}
              nextMessageContent={messages[index + 1]?.content}
              isLatestPaperPlanMessage={index === latestPaperPlanIndex}
              isBeingEdited={Boolean(editingMessageId) && message.id === editingMessageId}
            />
          );
        })}
      </div>
    </div>
  );
}

export default ChatPane;
