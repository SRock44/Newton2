import { useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactElement } from "react";
import { isValidElement } from "react";

type PreProps = ComponentPropsWithoutRef<"pre"> & { node?: unknown };

function extractLanguage(children: PreProps["children"]): string {
  const codeChild = Array.isArray(children) ? children[0] : children;
  if (isValidElement(codeChild)) {
    const className = (codeChild as ReactElement<{ className?: string }>).props.className;
    const match = /language-(\w+)/.exec(className ?? "");
    if (match) return match[1];
  }
  return "text";
}

/** Renders fenced code blocks with a language label and a copy-to-clipboard button. */
function CodeBlock({ children, node: _node, ...rest }: PreProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const language = extractLanguage(children);

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
