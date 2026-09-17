/**
 * Repairs one specific, real way a model breaks this app's fenced-block contract.
 *
 * Every rich block Newton renders in chat — ```plotly-figure, ```math-steps, ```options,
 * ```paper-plan, ```step-check, ```checkpoint, ```newton-note, ```artifact-plan,
 * ```newton-artifact — depends on the model emitting a CommonMark fenced code block, and
 * CommonMark requires the opening fence to start at the beginning of a line. When the
 * model writes the fence glued to the end of the preceding sentence:
 *
 *     Building it now — this takes a minute or two, so hang tight.```newton-artifact
 *     {"document_id": "…", "title": "…"}
 *     ```
 *
 * ...those backticks are not a fence at all. react-markdown degrades it to an untagged
 * code block, so CodeBlock sees no `language-*` class, and the student gets raw JSON
 * behind a "Copy" button instead of the live artifact. Observed for real against the
 * deployed backend (an interactive artifact that had genuinely been built and stored
 * rendered as plain text), which is why this exists.
 *
 * The fix is deliberately narrow: put a blank line before an opening fence ONLY when its
 * info string is one of this app's own block languages, and only when something other
 * than a newline precedes it on that line. It does not touch ordinary ```python /
 * ```js / bare ``` fences (a model writing those inline may well mean inline code), and
 * it does not try to repair a mangled CLOSING fence — the failure actually seen is the
 * opening one, and a broader rewrite risks corrupting the inside of a legitimate code
 * block that happens to contain backticks.
 */

/** The block languages CodeBlock.tsx dispatches on. Keep in sync with that file's
 * `language === "…"` branches — a language missing here simply isn't repaired, which is
 * the pre-existing behavior, never a crash. */
export const CUSTOM_BLOCK_LANGUAGES = [
  "plotly-figure",
  "math-steps",
  "options",
  "paper-plan",
  "step-check",
  "checkpoint",
  "newton-note",
  "artifact-plan",
  "newton-artifact",
] as const;

const OPENING_FENCE_RE = new RegExp(
  // (1) a character that is not a newline, then (2) three-or-more backticks immediately
  // followed by one of our languages and a word boundary.
  `([^\\n])(\`{3,}(?:${CUSTOM_BLOCK_LANGUAGES.join("|")})\\b)`,
  "g",
);

export function normalizeFencedBlocks(content: string): string {
  if (!content.includes("```")) return content;
  return content.replace(OPENING_FENCE_RE, "$1\n\n$2");
}
