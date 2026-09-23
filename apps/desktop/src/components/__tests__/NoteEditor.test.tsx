import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import NoteEditor, { joinNote, splitNote } from "../NoteEditor";

const card = (action: string, text: string) => "```newton-note\n" + JSON.stringify({ action, text }) + "\n```";

describe("splitNote / joinNote", () => {
  it("round-trips any note exactly", () => {
    const samples = [
      "",
      "plain",
      "a\n\n" + card("define", "x") + "\n\nb",
      card("explain", "only a card"),
      "a\n\n" + card("define", "x") + "\n" + card("explain", "y") + "\n\nend\n",
    ];
    for (const s of samples) expect(joinNote(splitNote(s))).toBe(s);
  });

  it("alternates text and card segments, starting and ending with text", () => {
    const segs = splitNote("a\n\n" + card("define", "x") + "\n\nb");
    expect(segs.map((g) => g.kind)).toEqual(["text", "note", "text"]);
    expect(splitNote(card("define", "x")).map((g) => g.kind)).toEqual(["text", "note", "text"]);
  });
});

function Harness({ initial, onChange }: { initial: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <NoteEditor
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe("NoteEditor", () => {
  it("an empty note is a live text field", () => {
    render(<Harness initial="" />);
    expect(screen.getByPlaceholderText("Start writing…")).toBeInTheDocument();
  });

  it("typing into a new note updates the value", async () => {
    const onChange = vi.fn();
    render(<Harness initial="" onChange={onChange} />);
    await userEvent.setup().type(screen.getByPlaceholderText("Start writing…"), "hi");
    expect(onChange).toHaveBeenLastCalledWith("hi");
  });

  it("renders text as markdown until clicked, then edits the raw markdown", async () => {
    const user = userEvent.setup();
    render(<Harness initial="# Title" />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    await user.click(screen.getByRole("heading", { name: "Title" }));
    expect(await screen.findByDisplayValue("# Title")).toBeInTheDocument();
  });

  it("a card is never shown as raw fence/JSON, and the space after it is writable", async () => {
    const onChange = vi.fn();
    render(<Harness initial={"Intro.\n\n" + card("define", "**Term** means x.")} onChange={onChange} />);
    expect(screen.getByText("Newton defined")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("```");
    const tail = screen.getByPlaceholderText("Keep writing…");
    await userEvent.setup().type(tail, "More");
    // typed after the card, separated by a blank line so it cannot glue to the fence
    expect(onChange).toHaveBeenLastCalledWith("Intro.\n\n" + card("define", "**Term** means x.") + "\n\nMore");
  });

  it("keeps a typed trailing newline in the last segment", async () => {
    const user = userEvent.setup();
    render(<Harness initial="" />);
    const field = screen.getByPlaceholderText("Start writing…") as HTMLTextAreaElement;
    await user.type(field, "line one{Enter}");
    expect(field.value).toBe("line one\n");
  });

  it("reports highlighted text in the editing field", () => {
    const onSelection = vi.fn();
    render(<NoteEditor value="Use LIATE here" onChange={() => {}} onSelection={onSelection} editingIndex={0} />);
    const field = screen.getByDisplayValue("Use LIATE here") as HTMLTextAreaElement;
    field.setSelectionRange(4, 9);
    fireEvent.mouseUp(field, { clientX: 30, clientY: 40 });
    expect(onSelection).toHaveBeenCalledWith({ text: "LIATE", top: 40, left: 30 });
  });
});
