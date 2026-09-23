import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import NewtonNoteBlockView from "../components/NewtonNoteBlock";

/**
 * The Notepad's Newton card as a block node inside the live editor: what Explain / Define /
 * Summarize insert. In the stored markdown it is still the ```newton-note fence with its JSON
 * (so existing notes, autosave, drafts and the backend are unchanged); in the editor it is only
 * ever the card, never the raw fence. A card is one atom: it can be selected and deleted (the
 * "×" on hover, or Backspace), but its text isn't edited in place.
 */

export type NewtonNoteAction = "explain" | "define" | "summarize";

const FENCE = /^```newton-note\n([\s\S]*?)\n```[ \t]*(?:\n|$)/;

function NewtonNoteView({ node, deleteNode, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper className="note-editor__card" contentEditable={false}>
      <NewtonNoteBlockView json={JSON.stringify({ action: node.attrs.action, text: node.attrs.text })} />
      {editor.isEditable && (
        <button
          type="button"
          className="note-editor__card-remove"
          aria-label="Remove Newton's note"
          title="Remove this note"
          onClick={() => deleteNode()}
        >
          ×
        </button>
      )}
    </NodeViewWrapper>
  );
}

const NewtonNote = Node.create({
  name: "newtonNote",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      action: {
        default: "explain",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-action"),
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-action": attrs.action as string }),
      },
      text: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-text"),
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-text": attrs.text as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="newton-note"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "newton-note" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NewtonNoteView);
  },

  // ---- markdown: the same ```newton-note fence the app has always stored
  markdownTokenizer: {
    name: "newtonNote",
    level: "block",
    start: (src: string) => src.indexOf("```newton-note"),
    tokenize: (src: string) => {
      const match = src.match(FENCE);
      if (!match) return undefined;
      try {
        const parsed = JSON.parse(match[1]);
        if (
          typeof parsed.text !== "string" ||
          !parsed.text.trim() ||
          (parsed.action !== "explain" && parsed.action !== "define" && parsed.action !== "summarize")
        ) {
          return undefined; // not a valid card: leave it to the ordinary code-block handling
        }
        return { type: "newtonNote", raw: match[0], action: parsed.action, text: parsed.text };
      } catch {
        return undefined;
      }
    },
  },
  parseMarkdown: (token) => {
    const card = token as unknown as { action: string; text: string };
    return { type: "newtonNote", attrs: { action: card.action, text: card.text } };
  },
  renderMarkdown: (node: { attrs?: { action?: string; text?: string } }) =>
    "```newton-note\n" + JSON.stringify({ action: node.attrs?.action, text: node.attrs?.text }) + "\n```",
});

export default NewtonNote;
