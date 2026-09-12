import type { ChatMessage } from "../types";
import MessageContent from "./MessageContent";

interface MessageBubbleProps {
  message: ChatMessage;
}

function formatTime(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const roleLabel = isUser ? "You" : message.role === "assistant" ? "Newton" : message.role;
  const time = formatTime(message.created_at);

  return (
    <div className={`message-row message-row--${isUser ? "user" : "assistant"}`}>
      <div className="message-meta">
        {roleLabel}
        {time ? ` · ${time}` : ""}
      </div>
      <div
        className={`message-bubble${message.error ? " message-bubble--error" : ""}`}
        data-context-menu="message"
        data-message-content={message.content}
      >
        <MessageContent content={message.content || " "} />
        {message.streaming && (
          <span className="streaming-dots" aria-label="Newton is responding">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
