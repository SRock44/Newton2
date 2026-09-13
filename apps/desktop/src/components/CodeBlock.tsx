import { useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import MathSteps from "./MathSteps";
import PlotlyFigure from "./PlotlyFigure";
import { hashString } from "../lib/hashString";

type PreProps = ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
  /** From MessageContent — a stable per-message key (session + message identity) used
   * to build a math-steps block's reveal-progress storage key. Undefined when the
   * containing message has no stable identity yet (still streaming in). */
  mathStepsPersistKeyPrefix?: string;
};

function extractLanguage(children: PreProps["children"]): string {
  const codeChild = Array.isArray(children) ? children[0] : children;
  if (isValidElement(codeChild)) {
    const className = (codeChild as ReactElement<{ className?: string }>).props.className;
    // Allow hyphens (e.g. "language-plotly-figure"), not just \w.
    const match = /language-([\w-]+)/.exec(className ?? "");
    if (match) return match[1];
  }
  return "text";
}

/** Walks a React children tree and concatenates every string/number leaf — needed
 * because rehype-highlight rewrites code content into nested highlighted <span>s, so
 * `children` is no longer a plain string by the time it reaches this component. */
function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Renders fenced code blocks with a language label and a copy-to-clipboard button —
 * except a "plotly-figure" block, which renders as an actual interactive chart, or a
 * "math-steps" block, which renders as a progressive-reveal derivation. */
function CodeBlock({ children, node: _node, mathStepsPersistKeyPrefix, ...rest }: PreProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const language = extractLanguage(children);

  if (language === "plotly-figure") {
    return <PlotlyFigure json={extractText(children)} />;
  }
  if (language === "math-steps") {
    const text = extractText(children);
    // Keyed on the block's own content too (not just the message), so two distinct
    // math-steps blocks in one message never share a storage key.
    const storageKey = mathStepsPersistKeyPrefix
      ? `newton:mathsteps:${mathStepsPersistKeyPrefix}:${hashString(text)}`
      : undefined;
    return <MathSteps json={text} storageKey={storageKey} />;
  }

  async function handleCopy() {
    const text = preRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — nothing more we can do.
    }
  }

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__lang">{language}</span>
        <button type="button" className="code-block__copy" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre ref={preRef} {...rest}>
        {children}
      </pre>
    </div>
  );
}

export default CodeBlock;
