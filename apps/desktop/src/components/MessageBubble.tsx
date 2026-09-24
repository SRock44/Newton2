import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, synthesizeSpeech } from "../api";
import { splitForSpeech } from "../lib/speech";
import type { ChatMessage } from "../types";
import MessageContent from "./MessageContent";
import AttachedImage from "./AttachedImage";
import AttachedDocumentChip from "./AttachedDocumentChip";
import NewtonMark from "./NewtonMark";
import ThinkingIndicator from "./ThinkingIndicator";

interface MessageBubbleProps {
  message: ChatMessage;
  token: string;
  sessionId: string | null;
  onOpenSuggestedPanel: (panel: string) => void;
  /** Opens (or, for the currently-open one, closes) an attached document's chip split
   * with this chat — see App.tsx's handleOpenDocumentInChat / DocumentViewerPanel. */
  onOpenDocument: (documentId: string, filename: string) => void;
  /** The document currently open in that split panel, if any — so an attached-document
   * chip for that exact document can render itself as active (see
   * AttachedDocumentChip.tsx's `active` prop). */
  openDocumentId?: string | null;
  /** Sends a plain-text chat message on the student's behalf — for an "options" pick or
   * a "paper-plan" approval (see MessageContent/CodeBlock). Optional so existing call
   * sites/tests that never render one of those blocks don't need to pass it. */
  onSend?: (text: string) => void;
  /** Focuses the composer — for "paper-plan"'s "Request Changes" action. */
  onFocusComposer?: (title: string) => void;
  /** The plain text of the chat message immediately following this one in the full
   * session history, if any — see OptionsPicker.tsx for what this is used for. */
  nextMessageContent?: string;
  /** Whether this message holds the most recent ```paper-plan block in the whole
   * visible conversation — see PaperPlanCard.tsx / lib/paperPlanIndex.ts. */
  isLatestPaperPlanMessage?: boolean;
  /** Message editing (ROADMAP.md): true for the one message currently being edited (see
   * App.tsx's editingMessage state / ContextMenu's "Edit message") — a subtle highlight
   * so it's obvious which message the composer's populated text belongs to, distinct
   * from the composer's own "Editing message — Cancel" indicator. */
  isBeingEdited?: boolean;
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

type ListenStatus = "idle" | "loading" | "playing" | "paused";

/** "Listen" — reads a finished Newton reply aloud via the real POST /voice/synthesize
 * (see app/routers/voice.py), which returns WAV bytes this plays through the browser's
 * Audio API. The endpoint existed and worked, with a custom Piper TTS service behind it,
 * but nothing in the app had ever called it.
 *
 * Plan gating follows the precedent NotepadWindow.tsx already set for the sibling
 * /voice/transcribe endpoint, rather than inventing a second convention: the control is
 * offered to everyone and a free account gets the server's own honest message ("Voice is
 * a Pro feature — upgrade to Newton Pro…") in place of audio, shown as a quiet inline
 * note next to the button. The alternative — hiding it behind a getBillingStatus check —
 * would mean one billing fetch per message bubble on screen (there's no shared billing
 * context in this app; every consumer fetches its own), to hide a feature free students
 * would then have no way to discover.
 *
 * The synthesized audio is kept for the life of the bubble, so replaying a message
 * costs nothing and doesn't re-run real TTS compute on the server.
 *
 * `language`/`autoPlay`: Conversation Practice mode (see Composer.tsx's toggle/
 * language picker, app/tools/voice_tts.py's language param) — `language` requests a
 * matching Piper voice instead of always the default English one, and `autoPlay`
 * starts playback itself, once, the moment this button mounts (which only happens
 * once a reply has real, finished, non-streaming content — see the render condition
 * below), so the tutor's spoken reply is actually heard without a manual click. Every
 * other caller of this component leaves both unset and behaves exactly as before. */
function ListenButton({
  token,
  text,
  language,
  autoPlay,
}: {
  token: string;
  text: string;
  language?: string;
  autoPlay?: boolean;
}) {
  const [status, setStatus] = useState<ListenStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // The current chunk's audio element (see lib/speech.ts for why a reply is spoken in
  // chunks at all) and the index of the chunk it belongs to.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const indexRef = useRef(0);
  // Synthesized chunks, kept for the life of the bubble so replaying — or resuming after
  // a stop — never re-spends real TTS compute on words already rendered.
  const urlsRef = useRef<Map<number, string>>(new Map());
  const pendingRef = useRef<Map<number, Promise<string>>>(new Map());
  // Aborts in-flight synthesize calls. Real TTS takes real server time, and the student
  // must be able to take the request back during that wait rather than being locked out
  // until the voice starts on its own.
  const abortRef = useRef<AbortController | null>(null);
  // Bumped by stop()/release() so an async continuation that was already in flight can
  // tell it has been superseded and must not start talking over the student.
  const runRef = useRef(0);

  const chunks = useMemo(() => splitForSpeech(text), [text]);

  function release() {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    pendingRef.current.clear();
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current.clear();
    indexRef.current = 0;
  }

  /** Hard stop: silence it now and rewind to the first chunk, so the next "Listen"
   * starts from the top instead of resuming mid-sentence. Deliberately distinct from
   * pause — "make it stop talking" is the thing a student actually wants a button for,
   * and pause alone (which leaves it poised mid-word) doesn't read as that. Cached
   * audio is KEPT, so starting again is instant. */
  function stop() {
    runRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    audioRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    pendingRef.current.clear();
    indexRef.current = 0;
    setStatus("idle");
  }

  // Stop and discard cached audio if this bubble's text changes out from under it (a
  // re-rendered/edited history entry) — playing stale narration of text no longer on
  // screen would be worse than simply re-synthesizing on the next click.
  useEffect(() => {
    release();
    setStatus("idle");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Never leave audio playing into a conversation the student has navigated away from.
  useEffect(() => release, []);

  /** Synthesizes one chunk, de-duplicated: asking twice for the same index (which
   * happens whenever playback reaches a chunk that prefetch already started) joins the
   * one in flight rather than paying for it twice. */
  function fetchChunk(index: number): Promise<string> {
    const cached = urlsRef.current.get(index);
    if (cached) return Promise.resolve(cached);
    const inFlight = pendingRef.current.get(index);
    if (inFlight) return inFlight;

    const controller = abortRef.current ?? new AbortController();
    abortRef.current = controller;
    // Omits the 4th arg entirely (rather than passing `undefined` positionally) when
    // no language was requested, so a plain "Listen" click sends exactly the same
    // 3-argument call it always has.
    const promise = (language
      ? synthesizeSpeech(token, chunks[index], controller.signal, language)
      : synthesizeSpeech(token, chunks[index], controller.signal)
    ).then((blob) => {
      const url = URL.createObjectURL(blob);
      urlsRef.current.set(index, url);
      pendingRef.current.delete(index);
      return url;
    });
    promise.catch(() => pendingRef.current.delete(index));
    pendingRef.current.set(index, promise);
    return promise;
  }

  /** Plays chunk `index`, and — this is the whole point — kicks off synthesis of the
   * NEXT chunk without waiting for it, so by the time this one finishes speaking the
   * next is usually already rendered. Only the first chunk's synthesis is ever a wait
   * the student actually sits through. */
  async function playFrom(index: number, run: number) {
    if (index >= chunks.length) {
      indexRef.current = 0;
      setStatus("idle");
      return;
    }
    if (!urlsRef.current.has(index)) setStatus("loading");

    const url = await fetchChunk(index);
    if (run !== runRef.current) return; // stopped/released while we were synthesizing

    // Build a buffer AHEAD of playback, two chunks deep. One deep isn't always enough:
    // the response is uncompressed WAV (~44KB per second of speech), so on a slow link a
    // chunk can still be downloading when the one before it finishes speaking —
    // measured on the dev box, chunk 1 ended at 3.35s while chunk 2 landed at 4.44s, an
    // audible gap. Two deep means each chunk has a full chunk's playback time to arrive.
    for (const ahead of [index + 1, index + 2]) {
      if (ahead < chunks.length) void fetchChunk(ahead).catch(() => {});
    }

    const audio = new Audio(url);
    audioRef.current = audio;
    indexRef.current = index;

    // Advance exactly once, on whichever event this engine actually delivers at the end
    // of a track. WebView2 fires `pause` immediately before `ended`, and was observed
    // delivering the `pause` WITHOUT a following `ended` — which stalled playback
    // permanently after the first chunk. Listening to both, with a latch, makes
    // continuation independent of that difference.
    let advanced = false;
    const advance = () => {
      if (advanced || run !== runRef.current) return;
      advanced = true;
      void playFrom(index + 1, run);
    };
    audio.onended = advance;
    // Keep the label honest if playback stops for a reason we didn't initiate (an audio
    // device change, the element being interrupted) — otherwise the button would keep
    // claiming "Pause" over silence.
    //
    // ...but a pause AT the end of a chunk is not a pause, it's the seam. WebView2 fires
    // it immediately before `ended` (confirmed against the real app: "+7760ms pause /
    // +7761ms ended"), so without this guard every seam flashed the button to "Resume".
    // `ended` isn't reliably set yet when `pause` fires, so the remaining-time check is
    // what actually does the work — and this is also the path that keeps playback moving
    // when `ended` never arrives at all (see `advance` above).
    audio.onpause = () => {
      const finished = audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration - 0.25);
      if (finished) {
        advance();
        return;
      }
      setStatus((s) => (s === "playing" ? "paused" : s));
    };
    await audio.play();
    if (run !== runRef.current) return;
    setStatus("playing");
  }

  /** Starts playback from scratch (chunk 0) -- the idle-state branch of a manual click
   * AND Conversation Practice's automatic play-on-mount (see the effect below), so
   * both paths share the exact same real synthesis/playback/error handling instead of
   * a second, parallel implementation. */
  async function beginPlayback() {
    if (chunks.length === 0) return;

    setError(null);
    abortRef.current = null;
    runRef.current += 1;
    const run = runRef.current;
    try {
      await playFrom(indexRef.current, run);
    } catch (err) {
      if (run !== runRef.current) return;
      // A cancel is a normal outcome the student asked for, not a failure to report.
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("idle");
        return;
      }
      setStatus("idle");
      setError(err instanceof ApiError ? err.message : "Couldn't read that message aloud.");
    }
  }

  // Conversation Practice's auto-play: fires exactly once, right when this button
  // mounts with autoPlay set — which only happens once (see the render condition
  // below: not streaming, real content, no error), so this never re-triggers on a
  // later unrelated re-render of the same bubble. Deliberately does NOT depend on
  // `status` (which would re-run this every time playback's own state changes) — only
  // on the identity of the text/autoPlay this bubble was mounted with.
  useEffect(() => {
    if (!autoPlay) return;
    void beginPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, text]);

  async function handleClick() {
    // A click while a chunk is still being synthesized CANCELS it. Previously the button
    // was simply disabled for this whole stretch, which on a long reply meant the student
    // had asked for narration and then had to sit and wait for it with no way out.
    if (status === "loading") {
      stop();
      return;
    }
    if (status === "playing") {
      audioRef.current?.pause();
      setStatus("paused");
      return;
    }
    if (status === "paused" && audioRef.current) {
      await audioRef.current.play();
      setStatus("playing");
      return;
    }
    await beginPlayback();
  }

  const label =
    status === "loading" ? "Preparing… Cancel" : status === "playing" ? "Pause" : status === "paused" ? "Resume" : "Listen";
  const ariaLabel =
    status === "loading"
      ? "Cancel preparing this message to be read aloud"
      : status === "playing"
        ? "Pause reading this message aloud"
        : status === "paused"
          ? "Resume reading this message aloud"
          : "Read this message aloud";
  // A hard stop is offered the moment there's anything to stop — while it's being
  // prepared as well as while it's talking.
  const canStop = status !== "idle";

  return (
    <div className="message-actions">
      <button
        type="button"
        className={`message-listen${status === "playing" ? " message-listen--playing" : ""}`}
        onClick={handleClick}
        aria-label={ariaLabel}
        title={
          status === "loading"
            ? "Cancel — this reply is still being prepared"
            : "Have Newton read this reply out loud"
        }
      >
        <span aria-hidden="true">{status === "playing" ? "❚❚" : status === "loading" ? "✕" : "▶"}</span>
        {label}
      </button>
      {canStop && (
        <button
          type="button"
          className="message-listen message-listen--stop"
          onClick={stop}
          aria-label="Stop reading this message aloud"
          title="Stop"
        >
          <span aria-hidden="true">■</span>
          Stop
        </button>
      )}
      {error && (
        <span className="message-listen-note" role="status">
          {error}
        </span>
      )}
    </div>
  );
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
// bubbles: each turn is a grid row with a narrow marginal gutter and a full-measure
// body. Role is read from the surrounding chrome, never a literal "YOU"/"Newton" label
// — a small NewtonMark icon for the assistant, nothing at all for the student (its
// distinct background tint/accent border on .transcript-body already says "you" without
// a word), plus a hairline rule. Product feedback on the earlier literal-label version:
// "the YOU and the NEWTON on the left side of the chatbox is annoying and stupid" — the
// flowing single-column structure itself was praised separately and is unchanged here,
// only what renders inside the gutter changed. The timestamp stays out of the way too:
// present in the DOM for a11y/copy but visually hidden until the row is hovered (see
// App.css's ".transcript-time" hover-reveal), not a permanent fixture next to every
// message. See App.css's ".transcript-entry" rules for the rest.
function MessageBubble({
  message,
  token,
  sessionId,
  onOpenSuggestedPanel,
  onOpenDocument,
  openDocumentId,
  onSend,
  onFocusComposer,
  nextMessageContent,
  isLatestPaperPlanMessage,
  isBeingEdited,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  // Still used as an accessible name for the row (a screen-reader user still needs to
  // know who's speaking) even though no literal text renders in the gutter anymore.
  const roleLabel = isUser ? "You" : message.role === "assistant" ? "Newton" : message.role;
  const time = formatTime(message.created_at);
  const { text: afterImages, imageIds } = extractAttachedImages(message.content);
  const { text: displayContent, documents: attachedDocuments } = extractAttachedDocuments(afterImages);
  // Only a stable identity once the message has a real created_at (i.e. it came back
  // from history, not a reply still streaming live) — see MessageContent's persistKey.
  const persistKey = sessionId && message.created_at ? `${sessionId}|${message.created_at}` : undefined;

  const hasPlanNarration = Boolean(message.planNarration && message.planNarration.trim().length > 0);
  const hasActivity = Boolean(message.activity && message.activity.length > 0);
  const hasRealContent = Boolean(message.content && message.content.trim().length > 0);
  // Once real text or tool activity has landed, the plan chip is done being "live" --
  // same grayed-out/checked treatment tool chips already get, not an abrupt disappearance.
  const planNarrationDone = hasRealContent || hasActivity;
  // The "Newton is thinking" indicator exists to signal "genuinely nothing has arrived
  // yet" -- once any of text, tool activity, or the plan-narration chip has landed, one
  // of those is already telling the student Newton is working, so the redundant
  // indicator stops. It's also what App.tsx's handleSend renders synchronously the
  // instant a message is sent (a fresh placeholder message has none of the three yet),
  // so there is always visible activity from message zero, not just once a WS frame
  // eventually arrives — see ROADMAP.md's "always-visible thinking indicator" entry.
  const showStreamingDots = Boolean(message.streaming) && !hasRealContent && !hasActivity && !hasPlanNarration;

  return (
    <div
      className={`transcript-entry transcript-entry--${isUser ? "user" : "assistant"}${
        isBeingEdited ? " transcript-entry--editing" : ""
      }`}
      aria-label={roleLabel}
    >
      <div className="transcript-gutter">
        {!isUser && <NewtonMark size={16} className="transcript-mark" />}
        {time && (
          <span className="transcript-time" title={time}>
            {time}
          </span>
        )}
      </div>
      <div
        className={`transcript-body${message.error ? " transcript-body--error" : ""}${
          message.streaming ? " transcript-body--streaming" : ""
        }`}
        data-context-menu="message"
        data-message-content={message.content}
        data-message-role={message.role}
        data-message-id={message.id ?? ""}
      >
        {hasPlanNarration && (
          <div className="tool-activity plan-activity" aria-label="Newton's plan">
            <span
              className={`tool-activity-chip plan-chip${
                planNarrationDone ? " tool-activity-chip--done" : " plan-chip--live"
              }`}
            >
              <span className="tool-activity-icon plan-chip-icon" aria-hidden="true" />
              <span className="plan-chip-text">{message.planNarration}</span>
            </span>
          </div>
        )}
        {message.activity && message.activity.length > 0 && (
          <div className="tool-activity" aria-label="Newton's tool activity">
            {message.activity.map((entry, i) => {
              // Only a finished ("done") entry has a real outcome to show -- a
              // still-running tool's `verified` is always undefined (see
              // ToolActivityEntry's own docstring), so this can never flash a verified
              // badge on a chip that's still spinning.
              const isVerified = entry.done && entry.verified === true;
              return (
                <span
                  key={`${entry.tool}-${i}`}
                  className={`tool-activity-chip${entry.done ? " tool-activity-chip--done" : ""}${
                    isVerified ? " tool-activity-chip--verified" : ""
                  }`}
                  // A light stagger on entry so several tool calls in one reply read as a
                  // sequence rather than all popping in at once — same idea as the
                  // Sidebar's own session-list fade-up stagger.
                  style={{ animationDelay: `${Math.min(i, 6) * 70}ms` }}
                  title={isVerified ? "Computed with real math/code, not guessed" : undefined}
                >
                  <span className="tool-activity-icon" aria-hidden="true" />
                  {entry.label}
                  {isVerified && (
                    <span className="tool-activity-verified-badge" aria-label="Verified: computed, not guessed">
                      Verified
                    </span>
                  )}
                </span>
              );
            })}
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
              <AttachedDocumentChip
                key={doc.id}
                documentId={doc.id}
                filename={doc.filename}
                onOpen={onOpenDocument}
                active={doc.id === openDocumentId}
              />
            ))}
          </div>
        )}
        <MessageContent
          content={displayContent || " "}
          persistKey={persistKey}
          streaming={message.streaming}
          token={token}
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
        {showStreamingDots && <ThinkingIndicator />}
        {/* Only on a finished Newton reply with real text: there's nothing to read aloud
            for a still-streaming (or empty/errored) message, and a control that appears
            mid-stream and then changes what it would say is worse than one that waits. */}
        {!isUser && message.role === "assistant" && !message.streaming && !message.error && displayContent.trim() && (
          <ListenButton
            token={token}
            text={displayContent}
            language={message.ttsLanguage}
            autoPlay={message.conversationPractice}
          />
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
