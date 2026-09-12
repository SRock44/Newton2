import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import MessageBubble from "./MessageBubble";

interface ChatPaneProps {
  messages: ChatMessage[];
  loading: boolean;
  loadError: string | null;
}

function ChatPane({ messages, loading, loadError }: ChatPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="chat-pane" ref={containerRef}>
      {loadError && <div className="chat-pane-banner chat-pane-banner--error">{loadError}</div>}

      {loading && messages.length === 0 && !loadError && (
        <div className="chat-empty-state">
          <p>Loading conversation…</p>
        </div>
      )}

      {!loading && messages.length === 0 && !loadError && (
        <div className="chat-empty-state">
          <div className="chat-empty-state-mark" aria-hidden="true">
            N
          </div>
          <h2>Ask Newton anything</h2>
          <p>Start the conversation below — questions, explanations, problem sets, whatever you're studying.</p>
        </div>
      )}

      <div className="message-list" data-testid="message-list">
        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}
      </div>
    </div>
  );
}

export default ChatPane;
