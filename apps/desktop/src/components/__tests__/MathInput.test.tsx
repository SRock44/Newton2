import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MathInput from "../MathInput";

// jsdom has no real support for MathLive's <math-field> custom element (canvas/
// ResizeObserver-dependent internals) — same reasoning PlotlyFigure.test.tsx mocks
// Plotly itself rather than trying to run the real imperative library in tests. Mocking
// the "mathlive" package (dynamically imported by MathInput.tsx, same lazy-loading
// shape as PlotlyFigure.tsx's loadPlotly()) means `document.createElement("math-field")`
// just yields a plain, unregistered custom element (a real DOM node — supports
// attributes/properties/events fine), enough to exercise this wrapper's own
// imperative-sync logic end to end.
vi.mock("mathlive", () => ({}));

/** The field is created asynchronously (after the mocked dynamic `import("mathlive")`
 * resolves) — same as PlotlyFigure.test.tsx awaiting `newPlot` before asserting. */
async function getField(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    if (!container.querySelector(".math-input__field")) throw new Error("math-field not rendered yet");
  });
  return container.querySelector(".math-input__field") as HTMLElement;
}

describe("MathInput", () => {
  it("renders the math field and a keyboard-toggle button", async () => {
    const { container } = render(<MathInput value="" onChange={vi.fn()} ariaLabel="Your attempt" />);
    expect(await getField(container)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show math keyboard/i })).toBeInTheDocument();
  });

  it("sets the field's initial value and accessible name from props", async () => {
    const { container } = render(<MathInput value="x^2" onChange={vi.fn()} ariaLabel="Your attempt" />);
    const field = (await getField(container)) as HTMLElement & { value: string };
    expect(field.value).toBe("x^2");
    expect(field.getAttribute("aria-label")).toBe("Your attempt");
  });

  it("reports the field's LaTeX value on a MathLive input event", async () => {
    const onChange = vi.fn();
    const { container } = render(<MathInput value="" onChange={onChange} />);
    const field = (await getField(container)) as HTMLElement & { value: string };

    field.value = "x^2 + 6x + 9";
    fireEvent(field, new Event("input"));

    expect(onChange).toHaveBeenCalledWith("x^2 + 6x + 9");
  });

  it("syncs an externally-changed value prop onto the field", async () => {
    const { container, rerender } = render(<MathInput value="a" onChange={vi.fn()} />);
    const field = (await getField(container)) as HTMLElement & { value: string };
    expect(field.value).toBe("a");

    rerender(<MathInput value="b" onChange={vi.fn()} />);
    expect(field.value).toBe("b");
  });

  it("calls onSubmit on Enter, and prevents the default", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<MathInput value="x" onChange={vi.fn()} onSubmit={onSubmit} />);
    const field = await getField(container);

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    field.dispatchEvent(event);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not call onSubmit on Shift+Enter", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<MathInput value="x" onChange={vi.fn()} onSubmit={onSubmit} />);
    const field = await getField(container);

    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the field and the keyboard-toggle button when disabled", async () => {
    const { container } = render(<MathInput value="" onChange={vi.fn()} disabled />);
    const field = (await getField(container)) as HTMLElement & { disabled: boolean };
    expect(field.disabled).toBe(true);
    expect(screen.getByRole("button", { name: /show math keyboard/i })).toBeDisabled();
  });

  it("clicking the keyboard-toggle button focuses the field without throwing when no real virtual keyboard exists", async () => {
    const user = userEvent.setup();
    const { container } = render(<MathInput value="" onChange={vi.fn()} />);
    const field = (await getField(container)) as HTMLElement & { focus: () => void };
    const focusSpy = vi.spyOn(field, "focus");

    await user.click(screen.getByRole("button", { name: /show math keyboard/i }));
    expect(focusSpy).toHaveBeenCalled();
  });

  // Issue: MathLive's virtual keyboard used to render as a page-covering overlay that
  // could land nowhere near a field scrolled to the middle of a long transcript --
  // "if you open up the math calculator, you can't even see what you are typing
  // because it BLOCKS the textbox." Regardless of how well the keyboard itself gets
  // docked (see lib/mathKeyboardDock.ts), the field should always be scrolled into the
  // upper portion of view the moment its keyboard opens.
  it("scrolls the field into the upper portion of view when the keyboard-toggle button is clicked", async () => {
    const scrollIntoViewMock = vi.fn();
    // jsdom has no real scrollIntoView implementation -- stub it directly so the
    // optional-chained call in showKeyboard() has something real to hit and assert on.
    (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollIntoViewMock;

    try {
      const user = userEvent.setup();
      const { container } = render(<MathInput value="" onChange={vi.fn()} />);
      await getField(container);

      await user.click(screen.getByRole("button", { name: /show math keyboard/i }));

      expect(scrollIntoViewMock).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
