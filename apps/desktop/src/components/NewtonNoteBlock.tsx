/**
 * Fenced-block contract — Newton Notepad's highlight-to-act insertion (see
 * NotepadWindow.tsx / app/routers/notes.py's POST /notes/{id}/annotate): when a
 * student highlights a passage in Preview mode and picks Explain/Define/Summarize, the
 * generated text is inserted into the note's RAW markdown right after the highlighted
 * passage, wrapped in this block, so it renders as a visually distinct, read-only card
 * once re-rendered in Preview mode — clearly Newton-authored, not the student's own
 * writing:
 *
 * ```newton-note
 * {
 *   "action": "explain" | "define" | "summarize",
 *   "text": "…generated text…"
 * }
 * ```
 *
 * Read-only by design (it's inserted content, not something to interact with further)
 * — no onSend/answeredWith plumbing needed, unlike options/step-check/checkpoint.
 * Visually distinct via its own accent color (--color-success, unused by any other
 * fenced-block card — see App.css's `.newton-note` rules).
 */
interface NewtonNoteBlock {
  action: "explain" | "define" | "summarize";
  text: string;
}

const ACTION_LABELS: Record<NewtonNoteBlock["action"], string> = {
  explain: "Newton explained",
  define: "Newton defined",
  summarize: "Newton summarized",
};

function parseNewtonNoteBlock(json: string): NewtonNoteBlock | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null;
    if (parsed.action !== "explain" && parsed.action !== "define" && parsed.action !== "summarize") return null;
    return { action: parsed.action, text: parsed.text };
  } catch {
    return null;
  }
}

function NewtonNoteBlockView({ json }: { json: string }) {
  const block = parseNewtonNoteBlock(json);

  if (!block) {
    return <div className="newton-note newton-note--error">Couldn't render this insertion.</div>;
  }

  return (
    <div className="newton-note">
      <div className="newton-note__label">{ACTION_LABELS[block.action]}</div>
      <div className="newton-note__text">{block.text}</div>
    </div>
  );
}

export default NewtonNoteBlockView;
