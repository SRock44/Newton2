import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageContent from "../MessageContent";

describe("MessageContent", () => {
  it("renders markdown headings, emphasis, and lists", () => {
    render(<MessageContent content={"# Title\n\n**bold** text\n\n- one\n- two"} />);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders a GFM table", () => {
    const table = "| A | B |\n| - | - |\n| 1 | 2 |";
    render(<MessageContent content={table} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders inline and block math with KaTeX", () => {
    const { container } = render(
      <MessageContent content={"Inline $x^2$ and a block:\n\n$$\\int_0^1 x\\,dx$$"} />,
    );
    expect(container.querySelectorAll(".katex").length).toBeGreaterThan(0);
  });

  it("renders a fenced code block with a language label and a working copy button", async () => {
    const user = userEvent.setup();
    render(<MessageContent content={"```js\nconst x = 1;\n```"} />);

    expect(screen.getByText("js")).toBeInTheDocument();

    // jsdom ships a real Clipboard implementation; spy on its method rather
    // than replacing the object outright (user-event's setup can otherwise
    // clobber a wholesale navigator.clipboard replacement).
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    const copyButton = screen.getByRole("button", { name: /copy/i });
    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("const x = 1;"));
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });
});
