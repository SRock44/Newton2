import type { ChatMessage } from "../types";
import MessageContent from "./MessageContent";
import AttachedImage from "./AttachedImage";
import AttachedDocumentChip from "./AttachedDocumentChip";

interface MessageBubbleProps {
  message: ChatMessage;
  token: string;
  sessionId: string | null;
  onOpenSuggestedPanel: (panel: string) => void;
  /** Navigates to a specific document on the Documents page (see App.tsx's
   * handleOpenDocument / mainView) — threaded down the same way onOpenSuggestedPanel
   * is, for an attached-document chip's click. */
  onOpenDocument: (documentId: string) => void;
  /** Sends a plain-text chat message on the student's behalf — for an "options" pick or
   * a "paper-plan" approval (see MessageContent/CodeBlock). Optional so existing call
   * sites/tests that never render one of those blocks don't need to pass it. */
  onSend?: (text: string) => void;
  /** Focuses the composer — for "paper-plan"'s "Request Changes" action. */
  onFocusComposer?: () => void;
  /** The plain text of the chat message immediately following this one in the full
   * session history, if any — see OptionsPicker.tsx for what this is used for. */
  nextMessageContent?: string;
  /** Whether this message holds the most recent ```paper-plan block in the whole
   * visible conversation — see PaperPlanCard.tsx / lib/paperPlanIndex.ts. */
  isLatestPaperPlanMessage?: boolean;
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

interface AttachedDocumentRef {
  id: string;
  filename: string;
}

// The composer's "+" menu and "Chat about this document" tag an attached/referenced
// document onto the outgoing message as "[Attached document: <id>|<filename>]" (see
// Composer.tsx, App.tsx's handleChatAboutDocument) — pipe-delimited so the filename is
// available to render a chip without a second network round-trip, unlike the image
// marker above which needs to fetch real bytes for its thumbnail. Strip it out of the
// displayed text and turn it into a real clickable chip instead (see
// AttachedDocumentChip.tsx).
const ATTACHED_DOCUMENT_RE = /\[Attached document: ([^\]|]+)\|([^\]]+)\]/g;

function extractAttachedDocuments(content: string): { text: string; documents: AttachedDocumentRef[] } {
  const documents: AttachedDocumentRef[] = [];
  const text = content
    .replace(ATTACHED_DOCUMENT_RE, (_match, id: string, filename: string) => {
      documents.push({ id: id.trim(), filename: filename.trim() });
      return "";
    })
    .trim();
  return { text, documents };
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

// A conversation renders as a single flowing transcript column, not a stack of chat
// bubbles: each turn is a grid row with a narrow marginal gutter (role + timestamp,
// the way a printed dialogue or annotated notebook page marks who's speaking) and a
// full-measure body. Role is read from the gutter label and a hairline rule, never
// from left/right alignment — see App.css's ".transcript-entry" rules for the rest.
function MessageBubble({
  message,
  token,
  sessionId,
  onOpenSuggestedPanel,
  onOpenDocument,
  onSend,
  onFocusComposer,
  nextMessageContent,
  isLatestPaperPlanMessage,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const roleLabel = isUser ? "You" : message.role === "assistant" ? "Newton" : message.role;
  const time = formatTime(message.created_at);
  const { text: afterImages, imageIds } = extractAttachedImages(message.content);
  const { text: displayContent, documents: attachedDocuments } = extractAttachedDocuments(afterImages);
  // Only a stable identity once the message has a real created_at (i.e. it came back
  // from history, not a reply still streaming live) — see MessageContent's persistKey.
  const persistKey = sessionId && message.created_at ? `${sessionId}|${message.created_at}` : undefined;

  return (
    <div className={`transcript-entry transcript-entry--${isUser ? "user" : "assistant"}`}>
      <div className="transcript-gutter">
        <span className="transcript-role">{roleLabel}</span>
        {time && <span className="transcript-time">{time}</span>}
      </div>
      <div
        className={`transcript-body${message.error ? " transcript-body--error" : ""}${
          message.streaming ? " transcript-body--streaming" : ""
        }`}
        data-context-menu="message"
        data-message-content={message.content}
      >
        {message.activity && message.activity.length > 0 && (
          <div className="tool-activity" aria-label="Newton's tool activity">
            {message.activity.map((entry, i) => (
              <span
                key={`${entry.tool}-${i}`}
                className={`tool-activity-chip${entry.done ? " tool-activity-chip--done" : ""}`}
                // A light stagger on entry so several tool calls in one reply read as a
                // sequence rather than all popping in at once — same idea as the
                // Sidebar's own session-list fade-up stagger.
                style={{ animationDelay: `${Math.min(i, 6) * 70}ms` }}
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
        {attachedDocuments.length > 0 && (
          <div className="attached-documents">
            {attachedDocuments.map((doc) => (
              <AttachedDocumentChip key={doc.id} documentId={doc.id} filename={doc.filename} onOpen={onOpenDocument} />
            ))}
          </div>
        )}
        <MessageContent
          content={displayContent || " "}
          persistKey={persistKey}
          onSend={onSend}
          onFocusComposer={onFocusComposer}
          nextMessageContent={nextMessageContent}
          isLatestPaperPlanMessage={isLatestPaperPlanMessage}
        />
        {message.suggestedActions && message.suggestedActions.length > 0 && (
          <div className="suggested-actions">
            {message.suggestedActions.map((action, i) => (
              <button
                key={`${action.panel}-${i}`}
                type="button"
                className="suggested-action-btn"
                onClick={() => onOpenSuggestedPanel(action.panel)}
              >
                {action.label}
                <span className="suggested-action-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            ))}
          </div>
        )}
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
