import type { ChatMessage } from "../types";
import MessageContent from "./MessageContent";

interface MessageBubbleProps {
  message: ChatMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const roleLabel = isUser ? "You" : message.role === "assistant" ? "Newton" : message.role;

  return (
    <div className={`message-row message-row--${isUser ? "user" : "assistant"}`}>
      <div className={`message-bubble${message.error ? " message-bubble--error" : ""}`}>
        <div className="message-role">{roleLabel}</div>
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
