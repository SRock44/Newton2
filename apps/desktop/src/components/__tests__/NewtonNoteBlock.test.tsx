import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import NewtonNoteBlockView from "../NewtonNoteBlock";

const block = (action: string, text: string) => JSON.stringify({ action, text });

describe("NewtonNoteBlock", () => {
  it("labels the block by action", () => {
    render(<NewtonNoteBlockView json={block("define", "A term.")} />);
    expect(screen.getByText("Newton defined")).toBeInTheDocument();
    expect(screen.getByText("A term.")).toBeInTheDocument();
  });

  it("renders the generated text as markdown instead of showing raw ** markers", () => {
    const { container } = render(
      <NewtonNoteBlockView json={block("define", "**LIATE** is a mnemonic for choosing **u**.")} />,
    );
    expect(container.querySelectorAll(".newton-note__text strong")).toHaveLength(2);
    expect(container.textContent).not.toContain("**");
  });

  it("renders inline math", () => {
    const { container } = render(<NewtonNoteBlockView json={block("explain", "It equals $x^2$.")} />);
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("shows an error card for a malformed block", () => {
    render(<NewtonNoteBlockView json="not json" />);
    expect(screen.getByText("Couldn't render this insertion.")).toBeInTheDocument();
  });
});
