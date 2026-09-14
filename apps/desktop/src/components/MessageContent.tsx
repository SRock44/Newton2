import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import CodeBlock from "./CodeBlock";

interface MessageContentProps {
  content: string;
  /** A stable identity for the message this content belongs to (e.g. `sessionId|
   * created_at`) — threaded down to CodeBlock so a math-steps block can persist how
   * many steps have been revealed. Omit when the message has no stable identity yet
   * (still streaming in); reveal progress just won't survive a remount until it does. */
  persistKey?: string;
  /** Threaded down to CodeBlock for "options"/"paper-plan" blocks — see CodeBlock.tsx
   * for what each one means. */
  onSend?: (text: string) => void;
  onFocusComposer?: () => void;
  nextMessageContent?: string;
  isLatestPaperPlanMessage?: boolean;
}

/** Renders markdown, GFM tables, KaTeX math, and highlighted code blocks. */
function MessageContent({
  content,
  persistKey,
  onSend,
  onFocusComposer,
  nextMessageContent,
  isLatestPaperPlanMessage,
}: MessageContentProps) {
  // Defined inline (not module-scope) so it can close over these props — the alternative
  // is threading them through react-markdown's AST/node props, which it doesn't support.
  const components: Components = {
    pre: (preProps) => (
      <CodeBlock
        {...preProps}
        mathStepsPersistKeyPrefix={persistKey}
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
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MessageContent;
