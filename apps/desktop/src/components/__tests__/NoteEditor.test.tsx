import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import NoteEditor from "../NoteEditor";
import type { NoteEditorHandle } from "../NoteEditor";

const card = (action: string, text: string) => "```newton-note\n" + JSON.stringify({ action, text }) + "\n```";

/** The TipTap editor behind the contenteditable (TipTap hangs it on the DOM node). */
function editorOf(container: HTMLElement): Editor {
  const dom = container.querySelector(".ProseMirror") as HTMLElement & { editor: Editor };
  expect(dom).not.toBeNull();
  return dom.editor;
}

/** The markdown most recently reported by the editor. */
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as string;

describe("NoteEditor", () => {
  it("shows markdown formatted, as one live surface — headings and bold, no raw markers", () => {
    const { container } = render(<NoteEditor value={"# Title\n\nSome **bold** text"} onChange={() => {}} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(container.querySelector(".ProseMirror strong")?.textContent).toBe("bold");
    expect(container.textContent).not.toContain("#");
    expect(container.textContent).not.toContain("**");
  });

  it("uses the same message typography everywhere (the editable surface IS the rendered surface)", () => {
    const { container } = render(<NoteEditor value="text" onChange={() => {}} />);
    expect(container.querySelector(".ProseMirror")?.classList.contains("message-content")).toBe(true);
    // one surface: no separate textarea/preview
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("an empty note invites writing", () => {
    const { container } = render(<NoteEditor value="" onChange={() => {}} />);
    expect(container.querySelector("[data-placeholder]")?.getAttribute("data-placeholder")).toBe("Start writing…");
  });

  it("typing changes what is shown AND reports the note as markdown", async () => {
    const onChange = vi.fn();
    const { container } = render(<NoteEditor value="" onChange={onChange} />);
    const editor = editorOf(container);
    act(() => {
      editor.commands.insertContent("hello");
    });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("hello"));
    expect(container.querySelector(".ProseMirror")?.textContent).toContain("hello");
  });

  it('typing "# " makes a heading as you write it (no mode switch)', async () => {
    const onChange = vi.fn();
    const { container } = render(<NoteEditor value="" onChange={onChange} />);
    const editor = editorOf(container);
    act(() => {
      editor.commands.setContent("# Heading now", { contentType: "markdown" });
    });
    expect(await screen.findByRole("heading", { name: "Heading now" })).toBeInTheDocument();
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("# Heading now"));
  });

  it("shows a Newton card, never the raw fence, and stores it as the same fence", async () => {
    const onChange = vi.fn();
    const note = "Intro line.\n\n" + card("define", "**LIATE** is a mnemonic.") + "\n\nOutro line.";
    const { container } = render(<NoteEditor value={note} onChange={onChange} />);
    expect(await screen.findByText("Newton defined")).toBeInTheDocument();
    expect(container.textContent).not.toContain("```");
    expect(container.textContent).not.toContain('"action"');
    // an edit elsewhere keeps the card in the stored markdown, byte for byte
    const editor = editorOf(container);
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, "!");
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(last(onChange)).toContain(card("define", "**LIATE** is a mnemonic."));
    expect(last(onChange)).toContain("Intro line.");
  });

  it("insertCard puts the card after the paragraph containing the highlighted text", async () => {
    const onChange = vi.fn();
    const ref = createRef<NoteEditorHandle>();
    render(<NoteEditor ref={ref} value={"First paragraph.\n\nPick u by LIATE here.\n\nLast paragraph."} onChange={onChange} />);
    act(() => {
      ref.current!.insertCard("LIATE", "define", "A mnemonic.");
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(last(onChange)).toBe(
      "First paragraph.\n\nPick u by LIATE here.\n\n" + card("define", "A mnemonic.") + "\n\nLast paragraph.",
    );
  });

  it("insertCard falls back to the end of the note when the text can't be found", async () => {
    const onChange = vi.fn();
    const ref = createRef<NoteEditorHandle>();
    render(<NoteEditor ref={ref} value="Only paragraph." onChange={onChange} />);
    act(() => {
      ref.current!.insertCard("not there", "explain", "An explanation.");
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(last(onChange)).toBe("Only paragraph.\n\n" + card("explain", "An explanation."));
  });

  it("removing a card leaves the student's own text", async () => {
    const onChange = vi.fn();
    const note = "Intro line.\n\n" + card("explain", "An explanation.") + "\n\nOutro line.";
    render(<NoteEditor value={note} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Newton's note" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const out = last(onChange) as string;
    expect(out).not.toContain("newton-note");
    expect(out).toContain("Intro line.");
    expect(out).toContain("Outro line.");
  });

  it("read-only shows cards without a remove button", async () => {
    render(<NoteEditor value={card("explain", "An explanation.")} onChange={() => {}} readOnly />);
    expect(await screen.findByText("Newton explained")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Newton's note" })).not.toBeInTheDocument();
  });

  it("renders inline math", async () => {
    const { container } = render(<NoteEditor value="The area is $x^2$ here." onChange={() => {}} />);
    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
  });

  it("an externally changed value replaces the note without reporting a change", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<NoteEditor value="one" onChange={onChange} />);
    rerender(<NoteEditor value="two" onChange={onChange} />);
    expect(await screen.findByText("two")).toBeInTheDocument();
    expect(screen.queryByText("one")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports highlighted text", async () => {
    const onSelection = vi.fn();
    const { container } = render(<NoteEditor value="Use LIATE here" onChange={() => {}} onSelection={onSelection} />);
    const editor = editorOf(container);
    act(() => {
      editor.commands.setTextSelection({ from: 5, to: 10 }); // "LIATE"
    });
    fireEvent.mouseUp(container.querySelector(".ProseMirror")!);
    await waitFor(() => expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ text: "LIATE" })));
  });
});
