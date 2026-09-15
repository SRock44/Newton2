import { describe, it, expect, vi, afterEach } from "vitest";
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

  // Item 3 (ROADMAP.md): re-parsing the whole accumulated markdown string on every
  // single incoming token during streaming is real, repeated CPU work; the fix
  // debounces the re-render while `streaming` is true. The one thing that must never
  // regress is the final content actually showing -- a naive debounce could otherwise
  // leave a stale intermediate value on screen after streaming ends.
  describe("streaming debounce", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows the fully-accumulated final content once streaming ends, not a stale intermediate value", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { rerender } = render(<MessageContent content="Hel" streaming />);

      rerender(<MessageContent content="Hello" streaming />);
      rerender(<MessageContent content="Hello wor" streaming />);
      rerender(<MessageContent content="Hello world" streaming={false} />);

      // Streaming ended on this very update -- must render immediately, never wait out
      // a pending debounce window.
      expect(screen.getByText("Hello world")).toBeInTheDocument();
      expect(screen.queryByText("Hello wor")).not.toBeInTheDocument();
    });

    it("eventually renders the latest content while streaming stays on, once the debounce window elapses", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { rerender } = render(<MessageContent content="a" streaming />);

      rerender(<MessageContent content="ab" streaming />);
      rerender(<MessageContent content="abc" streaming />);

      await vi.advanceTimersByTimeAsync(100);

      expect(await screen.findByText("abc")).toBeInTheDocument();
    });

    it("never drops the final content even if streaming ends before the last debounce would have fired", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { rerender } = render(<MessageContent content="loading" streaming />);

      rerender(<MessageContent content="still going" streaming />);
      // Streaming flips off on the very next update, before the "still going" debounce
      // timer would ever have fired on its own.
      rerender(<MessageContent content="final answer" streaming={false} />);

      expect(screen.getByText("final answer")).toBeInTheDocument();
      expect(screen.queryByText("still going")).not.toBeInTheDocument();
    });

    it("renders immediately (no debounce) for a message that was never streaming", () => {
      render(<MessageContent content="already finished" />);
      expect(screen.getByText("already finished")).toBeInTheDocument();
    });
  });
});
