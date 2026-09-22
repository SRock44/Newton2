import type { ReactNode } from "react";

// A deliberately small markdown-lite renderer for the demo section's real captured
// reply text — not a port of apps/desktop's real MessageContent.tsx (which handles a lot
// more: citations, paper-plan cards, options pickers, none of which appear in these
// three transcripts). Handles exactly what the three real captured replies actually use:
// fenced ``` code blocks, **bold**, `inline code`, *italic*, "- " bullet lines, and
// blank-line paragraph breaks. Never alters the underlying text, only how it's rendered.

const INLINE_PATTERN = /(\*\*(.+?)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/g;

function formatInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b-${i}`}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(<code key={`${keyPrefix}-c-${i}`}>{match[4]}</code>);
    } else if (match[5] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-i-${i}`}>{match[6]}</em>);
    }
    lastIndex = INLINE_PATTERN.lastIndex;
    i += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderParagraph(paragraph: string, key: string, bulletClassName: string, paragraphClassName: string): ReactNode {
  const lines = paragraph.split("\n").filter((line) => line.length > 0);
  const isBulletList = lines.length > 0 && lines.every((line) => line.trimStart().startsWith("- "));

  if (isBulletList) {
    return (
      <ul key={key} className={bulletClassName}>
        {lines.map((line, idx) => (
          <li key={`${key}-li-${idx}`}>{formatInline(line.trim().slice(2), `${key}-li-${idx}`)}</li>
        ))}
      </ul>
    );
  }

  return (
    <p key={key} className={paragraphClassName}>
      {lines.map((line, idx) => (
        <span key={`${key}-ln-${idx}`}>
          {formatInline(line, `${key}-ln-${idx}`)}
          {idx < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  );
}

export interface RenderReplyMarkdownClassNames {
  paragraph: string;
  bulletList: string;
  codeBlock: string;
}

export function renderReplyMarkdown(text: string, classNames: RenderReplyMarkdownClassNames): ReactNode[] {
  const parts = text.split(/```([\s\S]*?)```/g);
  const nodes: ReactNode[] = [];

  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      nodes.push(
        <pre key={`code-${i}`} className={classNames.codeBlock}>
          <code>{part.replace(/^\n/, "")}</code>
        </pre>
      );
      return;
    }
    const paragraphs = part
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    paragraphs.forEach((p, j) => {
      nodes.push(renderParagraph(p, `p-${i}-${j}`, classNames.bulletList, classNames.paragraph));
    });
  });

  return nodes;
}
