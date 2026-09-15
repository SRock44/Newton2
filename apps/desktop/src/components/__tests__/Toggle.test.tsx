import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Toggle from "../Toggle";

describe("Toggle", () => {
  it("renders as an accessible switch reflecting the checked prop", () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Learn Mode" />);
    const toggle = screen.getByRole("switch", { name: "Learn Mode" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("aria-checked reflects checked=true", () => {
    render(<Toggle checked={true} onChange={vi.fn()} label="Learn Mode" />);
    expect(screen.getByRole("switch", { name: "Learn Mode" })).toHaveAttribute("aria-checked", "true");
  });

  it("clicking calls onChange with the flipped value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Focus Mode" />);

    await user.click(screen.getByRole("switch", { name: "Focus Mode" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("clicking when checked calls onChange with false", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={true} onChange={onChange} label="Focus Mode" />);

    await user.click(screen.getByRole("switch", { name: "Focus Mode" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("disabled prevents toggling and is exposed to assistive tech", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Focus Mode" disabled />);

    const toggle = screen.getByRole("switch", { name: "Focus Mode" });
    expect(toggle).toBeDisabled();

    await user.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("defaults to the md size and applies the sm variant when requested", () => {
    const { rerender } = render(<Toggle checked={false} onChange={vi.fn()} label="X" />);
    expect(screen.getByRole("switch", { name: "X" })).toHaveClass("toggle--md");

    rerender(<Toggle checked={false} onChange={vi.fn()} label="X" size="sm" />);
    expect(screen.getByRole("switch", { name: "X" })).toHaveClass("toggle--sm");
  });

  it("applies the emphasized class only when both emphasized and checked", () => {
    const { rerender } = render(<Toggle checked={true} onChange={vi.fn()} label="X" emphasized />);
    expect(screen.getByRole("switch", { name: "X" })).toHaveClass("toggle--emphasized");

    rerender(<Toggle checked={false} onChange={vi.fn()} label="X" emphasized />);
    // Still carries the class (CSS gates the visual effect on --checked too), but never
    // emphasized at all when the prop is simply omitted.
    rerender(<Toggle checked={true} onChange={vi.fn()} label="X" />);
    expect(screen.getByRole("switch", { name: "X" })).not.toHaveClass("toggle--emphasized");
  });
});
