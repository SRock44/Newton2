import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import CodeBlock from "./CodeBlock";
import { normalizeFencedBlocks } from "../lib/fencedBlocks";

interface MessageContentProps {
  content: string;
  /** A stable identity for the message this content belongs to (e.g. `sessionId|
   * created_at`) — threaded down to CodeBlock so a math-steps block can persist how
   * many steps have been revealed. Omit when the message has no stable identity yet
   * (still streaming in); reveal progress just won't survive a remount until it does. */
  persistKey?: string;
  /** True while this message's assistant reply is still streaming in — debounces the
   * markdown re-parse below (see STREAMING_DEBOUNCE_MS) instead of re-running it on
   * every single incoming token. Omit (or false) for history/finished replies, which
   * always render immediately — the debounce path is opt-in, never the default. */
  streaming?: boolean;
  /** Bearer token, threaded down to CodeBlock for a "newton-artifact" block — that one
   * fetches the artifact's real HTML bytes from GET /documents/{id}/raw, which is
   * auth-gated (see ArtifactBlock.tsx). No other block type needs it. */
  token?: string;
  /** Threaded down to CodeBlock for "options"/"paper-plan" blocks — see CodeBlock.tsx
   * for what each one means. */
  onSend?: (text: string) => void;
  onFocusComposer?: (title: string) => void;
  nextMessageContent?: string;
  isLatestPaperPlanMessage?: boolean;
}

// Real CPU work -- especially rehypeHighlight's syntax tokenizing -- re-runs on the
// WHOLE accumulated string every time `content` changes below. During active
// streaming that's once per incoming token, which is what actually makes a long reply
// with a code block feel chunky even though the network-level chunk granularity is
// fine. A short trailing-edge debounce coalesces a burst of token updates into one
// re-parse; well under human-perceptible latency, so it doesn't read as "slower."
const STREAMING_DEBOUNCE_MS = 50;

/** Renders markdown, GFM tables, KaTeX math, and highlighted code blocks. */
function MessageContent({
  content,
  persistKey,
  streaming,
  token,
  onSend,
  onFocusComposer,
  nextMessageContent,
  isLatestPaperPlanMessage,
}: MessageContentProps) {
  // Tracks what's actually handed to ReactMarkdown. While streaming, updates to it are
  // debounced (see the effect below); once streaming ends (or for any message that was
  // never streaming, e.g. loaded history) it always mirrors `content` immediately, so
  // the final, fully-accumulated text is never left stale behind a pending debounce.
  const [renderedContent, setRenderedContent] = useState(content);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // The blank-content case (MessageBubble passes a single " " placeholder for an
    // empty message -- see its own `displayContent || " "`) also covers a brand new
    // streaming placeholder reusing a PREVIOUS, unrelated message's slot in the list --
    // e.g. message editing (ROADMAP.md) truncates a finished reply and immediately
    // appends a fresh `{ content: "", streaming: true }` placeholder at the same array
    // index, so React (matched by ChatPane's key) reuses this same MessageContent
    // instance rather than mounting a new one. Content only ever grows during a real
    // stream, so blank while streaming can only mean a fresh start, never a mid-stream
    // event worth coalescing -- update immediately rather than let the debounce below
    // leave the OLD message's rendered text on screen for up to STREAMING_DEBOUNCE_MS
    // after the new (unrelated) one has already started.
    if (!streaming || content.trim() === "") {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setRenderedContent(content);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setRenderedContent(content);
    }, STREAMING_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, streaming]);

  // Defined inline (not module-scope) so it can close over these props — the alternative
  // is threading them through react-markdown's AST/node props, which it doesn't support.
  const components: Components = {
    pre: (preProps) => (
      <CodeBlock
        {...preProps}
        mathStepsPersistKeyPrefix={persistKey}
        token={token}
        onSend={onSend}
        onFocusComposer={onFocusComposer}
        nextMessageContent={nextMessageContent}
        isLatestPaperPlanMessage={isLatestPaperPlanMessage}
      />
    ),
  };

  return (
    <div className="message-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={components}
      >
        {/* Repairs an opening fence the model glued to the end of the previous line,
            which would otherwise silently degrade a real rich block (an artifact, a
            chart, a plan card) into raw JSON behind a Copy button. See
            lib/fencedBlocks.ts for exactly what it does and does not touch. */}
        {normalizeFencedBlocks(renderedContent)}
      </ReactMarkdown>
    </div>
  );
}

export default MessageContent;
