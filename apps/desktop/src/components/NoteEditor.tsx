import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { InputRule } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Marked } from "marked";
import Placeholder from "@tiptap/extension-placeholder";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import NewtonNote from "../lib/newtonNoteExtension";
import type { NewtonNoteAction } from "../lib/newtonNoteExtension";

// Module-scope, runs once: a dedicated `Marked` instance for @tiptap/markdown to parse/
// serialize with, instead of the package's own default (the shared `marked` singleton
// export). That default was tried first and genuinely doesn't work for this: calling the
// singleton's own `marked.use(...)` to override a tokenizer rule, then letting
// @tiptap/markdown call the singleton's own `.lexer()`/`.parse()`, silently never applies
// the override (confirmed directly against the `marked` package in isolation, nothing to
// do with Tiptap) -- apparently a quirk of that convenience export, not of `.use()`
// itself. A real, explicitly-constructed `new Marked()` instance configured and used the
// same way works correctly. The `as never` below is because @tiptap/markdown's own type
// for this option is the singleton's own (narrower, callable-function-shaped) type, which
// a plain `Marked` instance doesn't structurally match even though it implements every
// method actually called on it (`.use`, `.lexer`, `.parse`, ...) -- a real mismatch
// between that package's types and the fix its own singleton's behavior requires, not
// something to paper over by going back to the broken singleton.
//
// The bug this closes: a note typed as plain paragraphs with leading spaces for visual
// indentation (pseudocode, an outline) looked fine while editing, but came back as a
// monospace code block with literal `\[`/`&lt;` in it after a save + reopen. Root cause
// was CommonMark's own "indented code block" shorthand: 4+ leading spaces on a line is,
// by default, code-block syntax, not a styling hint. So `ed.getMarkdown()` serialized
// the indented paragraph text as plain markdown (correctly escaping `[`/`<` etc. for
// *paragraph* context), but re-parsing that same markdown on reopen saw the leading
// spaces and reinterpreted the whole block as a CODE block instead of a paragraph --
// and markdown escape sequences are never processed inside code blocks, so the
// characters that were escaped for safe paragraph serialization came back out literal
// instead of decoding. Disabling just this one tokenizer rule stops the reinterpretation
// at the root; real fenced ```code``` blocks (an explicit, deliberate action, not
// something a student's indentation habit can trigger by accident) are untouched.
const noteMarkdownParser = new Marked();
noteMarkdownParser.use({
  tokenizer: {
    code() {
      return undefined;
    },
  },
});

/**
 * The Notepad's single, live editor: what you type IS what you see. There is no Write/Preview
 * split and no switch between a raw-markdown look and a rendered look — headings, bold, lists and
 * math are shown formatted as you write them (typing "# " makes a heading, "**x**" makes bold,
 * "$x^2$" makes math), in the same font and styling the whole time.
 *
 * Under the hood the note is still ONE markdown string (the backend, autosave, and local drafts
 * are unchanged): the editor parses it on the way in and serializes it on the way out. Newton's
 * answers (the ```newton-note fences Explain/Define/Summarize insert) are cards inside the note,
 * never a raw fence — see lib/newtonNoteExtension.tsx.
 */

export interface NoteSelection {
  text: string;
  top: number;
  left: number;
}

export interface NoteEditorHandle {
  /** Inserts a Newton card right after the paragraph containing `selectedText` (the last text
   * the student highlighted, or the first place it appears), or at the end of the note. */
  insertCard: (selectedText: string, action: NewtonNoteAction, text: string) => void;
  focus: () => void;
}

interface NoteEditorProps {
  /** The note's markdown. */
  value: string;
  onChange: (markdown: string) => void;
  /** Called with the highlighted text (and where to put the toolbar), or null when nothing is
   * highlighted any more. */
  onSelection?: (selection: NoteSelection | null) => void;
  readOnly?: boolean;
}

const KATEX = { throwOnError: false };

/** Math stays editable as source: clicking a rendered formula turns it back into its `$…$` text
 * (typing the closing `$` again re-renders it), so no separate dialog is needed. */
function mathExtensions(editorRef: { current: Editor | null }) {
  const toSource = (kind: "inline" | "block") => (node: { attrs: { latex?: string }; nodeSize: number }, pos: number) => {
    const ed = editorRef.current;
    if (!ed || !ed.isEditable) return;
    const latex = node.attrs.latex ?? "";
    const source = kind === "inline" ? `$${latex}$` : `$$${latex}$$`;
    ed.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, source).run();
  };
  return [
    InlineMath.extend({
      addInputRules() {
        // typing the closing "$" of $…$ turns it into a rendered formula
        return [
          new InputRule({
            find: /(?<!\$)\$([^$\n]+?)\$$/,
            handler: ({ state, range, match }) => {
              state.tr.replaceWith(range.from, range.to, this.type.create({ latex: match[1] }));
            },
          }),
        ];
      },
    }).configure({ katexOptions: KATEX, onClick: toSource("inline") }),
    BlockMath.configure({ katexOptions: { ...KATEX, displayMode: true }, onClick: toSource("block") }),
  ];
}

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { value, onChange, onSelection, readOnly },
  ref,
) {
  const editorRef = useRef<Editor | null>(null);
  // The last markdown this editor produced (or was given): a `value` prop equal to it is just our
  // own change coming back around and must not reset the document under the student's cursor.
  const lastMarkdown = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelection);
  onChangeRef.current = onChange;
  onSelectionRef.current = onSelection;
  const lastSelected = useRef<{ from: number; to: number; text: string } | null>(null);

  const reportSelection = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const { from, to, empty } = ed.state.selection;
    const text = empty ? "" : ed.state.doc.textBetween(from, to, " ").trim();
    if (!text) {
      lastSelected.current = null;
      onSelectionRef.current?.(null);
      return;
    }
    lastSelected.current = { from, to, text };
    // where the toolbar goes: just above the start of the selection
    let top = 0;
    let left = 0;
    try {
      const c = ed.view.coordsAtPos(from);
      top = c.top;
      left = c.left;
    } catch {
      /* no layout (tests): the numbers only position the toolbar */
    }
    onSelectionRef.current?.({ text, top, left });
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown.configure({ marked: noteMarkdownParser as never }),
      Placeholder.configure({
        placeholder: ({ editor: ed }) => (ed.isEmpty ? "Start writing…" : "Keep writing…"),
        showOnlyWhenEditable: false,
      }),
      ...mathExtensions(editorRef),
      NewtonNote,
    ],
    content: value,
    contentType: "markdown",
    editable: !readOnly,
    editorProps: {
      attributes: {
        // the same typography as Newton's rendered text everywhere else in the app
        class: "message-content note-editor__prose",
        "data-context-menu": "note-editable",
        role: "textbox",
        "aria-label": "Note",
        "aria-multiline": "true",
      },
      handleDOMEvents: {
        mouseup: () => {
          window.setTimeout(reportSelection, 0);
          return false;
        },
        keyup: () => {
          reportSelection();
          return false;
        },
      },
    },
    onUpdate: ({ editor: ed }) => {
      // the editor always keeps an empty paragraph at the end to write into; it isn't content
      const markdown = ed.getMarkdown().replace(/\s+$/, "");
      if (markdown === lastMarkdown.current) return; // e.g. the empty end paragraph being added
      lastMarkdown.current = markdown;
      onChangeRef.current(markdown);
    },
  });
  editorRef.current = editor;

  // An externally-changed note (another note opened, a draft restored, a lecture transcript
  // appended) replaces the document; our own edits coming back through `value` do not.
  useEffect(() => {
    if (!editor || value === lastMarkdown.current) return;
    lastMarkdown.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.commands.focus("end"),
      insertCard: (selectedText, action, text) => {
        const ed = editorRef.current;
        if (!ed) return;
        const { doc } = ed.state;
        let target: number | null = null;
        const hint = lastSelected.current;
        if (
          hint &&
          hint.text === selectedText &&
          hint.to <= doc.content.size &&
          doc.textBetween(hint.from, hint.to, " ").trim() === selectedText
        ) {
          target = hint.to;
        } else {
          doc.descendants((node, pos) => {
            if (target !== null) return false;
            if (node.isText && node.text) {
              const i = node.text.indexOf(selectedText);
              if (i >= 0) target = pos + i + selectedText.length;
            }
            return true;
          });
        }
        // the card goes after the whole paragraph (or list) the highlight is in — never in the
        // middle of a sentence
        const at = target === null ? doc.content.size : doc.resolve(target).depth >= 1 ? doc.resolve(target).after(1) : target;
        ed.chain().insertContentAt(at, { type: "newtonNote", attrs: { action, text } }).run();
      },
    }),
    [],
  );

  return (
    <div
      className="note-editor"
      onClick={(e) => {
        // the empty space around the text: keep writing at the end of the note
        if (e.target === e.currentTarget && !readOnly) editorRef.current?.commands.focus("end");
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
});

export default NoteEditor;
