import type { ChatMessage } from "../types";
import MessageContent from "./MessageContent";
import AttachedImage from "./AttachedImage";

interface MessageBubbleProps {
  message: ChatMessage;
  token: string;
  sessionId: string | null;
}

// The composer/snip-modal tag an uploaded image onto the outgoing message as
// "[Attached image: <id>]" (see Composer.tsx, App.tsx's handleSnipCapture) — plain text
// today, so it rendered as a raw bracket-and-UUID string. Strip it out of the displayed
// text and turn it into a real thumbnail instead (see AttachedImage.tsx). The full
// original text (marker included) stays available via data-message-content for copy.
const ATTACHED_IMAGE_RE = /\[Attached image: ([^\]]+)\]/g;

function extractAttachedImages(content: string): { text: string; imageIds: string[] } {
  const imageIds: string[] = [];
  const text = content
    .replace(ATTACHED_IMAGE_RE, (_match, id: string) => {
      imageIds.push(id.trim());
      return "";
    })
    .trim();
  return { text, imageIds };
}

function formatTime(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // No `hour12` override here on purpose: leaving it unset lets the runtime follow the
  // user's own locale/OS preference (12-hour "1:11 PM" for most US-style locales, 24-hour
  // where that's the norm) instead of forcing one format on everyone.
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function MessageBubble({ message, token, sessionId }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const roleLabel = isUser ? "You" : message.role === "assistant" ? "Newton" : message.role;
  const time = formatTime(message.created_at);
  const { text: displayContent, imageIds } = extractAttachedImages(message.content);
  // Only a stable identity once the message has a real created_at (i.e. it came back
  // from history, not a reply still streaming live) — see MessageContent's persistKey.
  const persistKey = sessionId && message.created_at ? `${sessionId}|${message.created_at}` : undefined;

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
        {message.activity && message.activity.length > 0 && (
          <div className="tool-activity" aria-label="Newton's tool activity">
            {message.activity.map((entry, i) => (
              <span
                key={`${entry.tool}-${i}`}
                className={`tool-activity-chip${entry.done ? " tool-activity-chip--done" : ""}`}
              >
                <span className="tool-activity-icon" aria-hidden="true" />
                {entry.label}
              </span>
            ))}
          </div>
        )}
        {imageIds.length > 0 && sessionId && (
          <div className="attached-images">
            {imageIds.map((id) => (
              <AttachedImage key={id} token={token} sessionId={sessionId} imageId={id} />
            ))}
          </div>
        )}
        <MessageContent content={displayContent || " "} persistKey={persistKey} />
        {message.stoppedByUser && <div className="message-stopped-note">Stopped</div>}
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
