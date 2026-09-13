import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import MessageBubble from "./MessageBubble";
import NewtonMark from "./NewtonMark";

interface ChatPaneProps {
  messages: ChatMessage[];
  loading: boolean;
  loadError: string | null;
  token: string;
  sessionId: string | null;
}

function ChatPane({ messages, loading, loadError, token, sessionId }: ChatPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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

      {!loading && messages.length === 0 && !loadError && (
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
        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} token={token} sessionId={sessionId} />
        ))}
      </div>
    </div>
  );
}

export default ChatPane;
