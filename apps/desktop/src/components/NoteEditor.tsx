import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import MessageContent from "./MessageContent";
import NewtonNoteBlockView from "./NewtonNoteBlock";

/**
 * The Notepad's single, live editor — there is no separate Write and Preview mode.
 *
 * The note is still stored as ONE raw markdown string (the backend, autosave, and drafts are
 * unchanged). What changed is how it is shown: the string is split into
 *
 *   - text segments — the student's own writing, and
 *   - Newton cards — the ```newton-note fenced blocks that Explain/Define/Summarize insert.
 *
 * Newton cards are always shown as cards (label, markdown, math), never as raw fence + JSON.
 * A text segment reads as rendered markdown (headings, math, lists) until the student clicks
 * into it, when it becomes an editable text field showing the raw markdown; leaving it renders
 * it again. Highlighting text in either state offers the same Explain/Define/Summarize toolbar.
 */

export interface NoteSegment {
  kind: "text" | "note";
  raw: string;
}

const FENCE_RE = /(```newton-note\n[\s\S]*?\n```)/;

/** Splits a note into alternating text / Newton-card segments. Always starts and ends with a
 * text segment (possibly empty), and `joinNote(splitNote(x)) === x` exactly. */
export function splitNote(content: string): NoteSegment[] {
  return content.split(FENCE_RE).map((raw, i) => ({ kind: i % 2 === 1 ? "note" : "text", raw }));
}

export function joinNote(segments: NoteSegment[]): string {
  return segments.map((s) => s.raw).join("");
}

/** The JSON inside a ```newton-note fence. */
function fenceJson(raw: string): string {
  return raw.replace(/^```newton-note\n/, "").replace(/\n```$/, "");
}

/** For a text segment: the newlines that only pad it away from a neighbouring card (never shown
 * in the editor) and the visible part. The first segment's leading text and the last segment's
 * trailing text belong to the student, so nothing is stripped there — which also keeps a typed
 * trailing newline from vanishing. */
function padding(raw: string, hasCardBefore: boolean, hasCardAfter: boolean) {
  const lead = hasCardBefore ? (raw.match(/^\n*/) as RegExpMatchArray)[0] : "";
  const rest = raw.slice(lead.length);
  const trail = hasCardAfter ? (rest.match(/\n*$/) as RegExpMatchArray)[0] : "";
  return { lead, core: rest.slice(0, rest.length - trail.length), trail };
}

export interface NoteSelection {
  text: string;
  top: number;
  left: number;
}

interface NoteEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Called with the highlighted text (and where to put the toolbar), or null when nothing is
   * highlighted any more. */
  onSelection?: (selection: NoteSelection | null) => void;
  /** Which text segment is being edited. Uncontrolled unless given (a frame-driven render passes
   * it in; the app leaves it out). */
  editingIndex?: number | null;
  readOnly?: boolean;
}

export default function NoteEditor({ value, onChange, onSelection, editingIndex, readOnly }: NoteEditorProps) {
  const [ownEditing, setOwnEditing] = useState<number | null>(null);
  const controlled = editingIndex !== undefined;
  const editing = controlled ? editingIndex : ownEditing;
  const setEditing = (i: number | null) => {
    if (!controlled) setOwnEditing(i);
  };

  const segments = splitNote(value);
  const lastIdx = segments.length - 1;
  const onlyOne = segments.length === 1;

  function replaceSegment(idx: number, raw: string) {
    onChange(joinNote(segments.map((s, i) => (i === idx ? { ...s, raw } : s))));
  }

  function editText(idx: number, next: string) {
    setEditing(idx); // typing into the empty end of the note makes it the segment being edited
    const { lead, trail } = padding(segments[idx].raw, idx > 0, idx < lastIdx);
    // a segment that just started (or ended) next to a card needs the blank line that keeps
    // the markdown parser from gluing it to the fence
    const nextLead = idx > 0 ? lead || "\n\n" : "";
    const nextTrail = idx < lastIdx ? trail || "\n\n" : "";
    replaceSegment(idx, nextLead + next + nextTrail);
  }

  function removeCard(idx: number) {
    onChange(joinNote(segments.filter((_, i) => i !== idx)));
    setEditing(null);
  }

  function handleTextMouseUp(event: ReactMouseEvent<HTMLTextAreaElement>) {
    const field = event.currentTarget;
    const text = field.value.slice(field.selectionStart, field.selectionEnd).trim();
    // a textarea has no per-character rects, so the pointer position stands in
    onSelection?.(text ? { text, top: event.clientY, left: event.clientX } : null);
  }

  function handleRenderedMouseUp(idx: number, event: ReactMouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    const text = selection && !selection.isCollapsed ? selection.toString().trim() : "";
    if (text && selection && selection.rangeCount > 0 && event.currentTarget.contains(selection.anchorNode)) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      onSelection?.({ text, top: rect.top, left: rect.left });
      return;
    }
    onSelection?.(null);
    if (!readOnly) setEditing(idx);
  }

  return (
    <div
      className="note-editor"
      onClick={(e) => {
        // the empty space around the text: keep writing at the end of the note
        if (e.target === e.currentTarget && !readOnly) setEditing(lastIdx);
      }}
    >
      {segments.map((seg, idx) => {
        if (seg.kind === "note") {
          return (
            <div className="note-editor__card" key={idx}>
              <NewtonNoteBlockView json={fenceJson(seg.raw)} />
              {!readOnly && (
                <button
                  type="button"
                  className="note-editor__card-remove"
                  aria-label="Remove Newton's note"
                  title="Remove this note"
                  onClick={() => removeCard(idx)}
                >
                  ×
                </button>
              )}
            </div>
          );
        }
        const { core } = padding(seg.raw, idx > 0, idx < lastIdx);
        // The end of the note is always writable: an empty last segment (a new note, or the
        // space after a card) is a live field, not a click target you have to find.
        const isTail = idx === lastIdx && !core.trim();
        if (editing === idx || isTail) {
          return (
            <AutoTextarea
              key={idx}
              value={core}
              placeholder={onlyOne ? "Start writing…" : "Keep writing…"}
              readOnly={readOnly}
              autoFocus={editing === idx && !controlled}
              onChange={(v) => editText(idx, v)}
              onBlur={() => setEditing(null)}
              onMouseUp={handleTextMouseUp}
            />
          );
        }
        if (!core.trim()) return <div className="note-editor__gap" key={idx} onClick={() => !readOnly && setEditing(idx)} />;
        return (
          <div
            key={idx}
            className="note-editor__rendered"
            data-context-menu="note-text"
            onMouseUp={(e) => handleRenderedMouseUp(idx, e)}
          >
            <MessageContent content={core} />
          </div>
        );
      })}
    </div>
  );
}

function AutoTextarea({
  value,
  onChange,
  placeholder,
  readOnly,
  autoFocus,
  onBlur,
  onMouseUp,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  onBlur: () => void;
  onMouseUp: (e: ReactMouseEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // grow with the text instead of scrolling inside a box
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && autoFocus) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      className="notepad-window__textarea note-editor__textarea"
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      rows={1}
      data-context-menu="note-editable"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onMouseUp={onMouseUp}
    />
  );
}
