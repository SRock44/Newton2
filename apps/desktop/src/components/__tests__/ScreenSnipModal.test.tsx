import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ScreenSnipModal from "../ScreenSnipModal";

function stubImageRect() {
  const image = screen.getByAltText("Screen capture") as HTMLImageElement;
  Object.defineProperty(image, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} }),
  });
  Object.defineProperty(image, "clientWidth", { value: 400, configurable: true });
  Object.defineProperty(image, "clientHeight", { value: 300, configurable: true });
  Object.defineProperty(image, "naturalWidth", { value: 1600, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: 1200, configurable: true });
  return image;
}

function drag(stage: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.mouseDown(stage, { clientX: from.x, clientY: from.y });
  fireEvent.mouseMove(stage, { clientX: to.x, clientY: to.y });
  fireEvent.mouseUp(stage);
}

describe("ScreenSnipModal", () => {
  it("calls onCancel when the background overlay is clicked", () => {
    const onCancel = vi.fn();
    render(<ScreenSnipModal dataUrl="data:image/png;base64,AAA" onCancel={onCancel} onCapture={vi.fn()} />);
    fireEvent.click(screen.getByRole("dialog").parentElement as Element);
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onCancel when the Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ScreenSnipModal dataUrl="data:image/png;base64,AAA" onCancel={onCancel} onCapture={vi.fn()} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables Send to Newton until a large-enough region is selected", () => {
    render(<ScreenSnipModal dataUrl="data:image/png;base64,AAA" onCancel={vi.fn()} onCapture={vi.fn()} />);
    expect(screen.getByText("Send to Newton")).toBeDisabled();
  });

  it("keeps Send disabled for a selection smaller than the minimum size", () => {
    render(<ScreenSnipModal dataUrl="data:image/png;base64,AAA" onCancel={vi.fn()} onCapture={vi.fn()} />);
    const image = stubImageRect();
    const stage = image.parentElement as Element;
    drag(stage, { x: 10, y: 10 }, { x: 12, y: 11 });
    expect(screen.getByText("Send to Newton")).toBeDisabled();
  });

  it("enables Send once a real region has been dragged out", () => {
    render(<ScreenSnipModal dataUrl="data:image/png;base64,AAA" onCancel={vi.fn()} onCapture={vi.fn()} />);
    const image = stubImageRect();
    const stage = image.parentElement as Element;
    drag(stage, { x: 20, y: 20 }, { x: 200, y: 150 });
    expect(screen.getByText("Send to Newton")).not.toBeDisabled();
  });

  it("does not extend the selection once the drag has ended", () => {
    render(<ScreenSnipModal dataUrl="data:image/png;base64,AAA" onCancel={vi.fn()} onCapture={vi.fn()} />);
    const image = stubImageRect();
    const stage = image.parentElement as Element;
    drag(stage, { x: 20, y: 20 }, { x: 200, y: 150 });
    // A stray mousemove after mouseup (no button held) must not change the selection.
    fireEvent.mouseMove(stage, { clientX: 5, clientY: 5 });
    expect(screen.getByText("Send to Newton")).not.toBeDisabled();
  });
});
