import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductTour from "../ProductTour";

function stubRect(el: Element, rect: Partial<DOMRect>) {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON() {},
      ...rect,
    }),
  });
}

/** Mounts the three real anchor elements ProductTour's steps target (mirroring
 * Sidebar.tsx/Composer.tsx/ContextPanel.tsx's own real `data-tour` attributes, not
 * invented selectors), each with a real, non-zero rect so computePlacement finds them. */
function mountAnchors() {
  const sidebar = document.createElement("button");
  sidebar.setAttribute("data-tour", "sidebar-brand");
  stubRect(sidebar, { left: 10, top: 10, right: 60, bottom: 40, width: 50, height: 30 });

  const composer = document.createElement("div");
  composer.setAttribute("data-tour", "composer");
  stubRect(composer, { left: 100, top: 500, right: 700, bottom: 560, width: 600, height: 60 });

  const contextPanel = document.createElement("aside");
  contextPanel.setAttribute("data-tour", "context-panel");
  stubRect(contextPanel, { left: 900, top: 10, right: 1000, bottom: 400, width: 100, height: 390 });

  document.body.append(sidebar, composer, contextPanel);
  return { sidebar, composer, contextPanel };
}

describe("ProductTour", () => {
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 800);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("opens on the first step, anchored to the real sidebar brand element", () => {
    mountAnchors();
    render(<ProductTour onFinish={vi.fn()} />);
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByText("This is Newton")).toBeInTheDocument();
  });

  it("walks forward through all three steps on Next, ending in 'Got it'", async () => {
    mountAnchors();
    const user = userEvent.setup();
    render(<ProductTour onFinish={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Ask anything — for real")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    expect(screen.getByText("It remembers your semester")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
  });

  it("calls onFinish exactly once after 'Got it' on the last step", async () => {
    mountAnchors();
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(<ProductTour onFinish={onFinish} />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Got it" }));

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("Skip dismisses immediately regardless of which step is showing", async () => {
    mountAnchors();
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(<ProductTour onFinish={onFinish} />);

    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("Escape dismisses the tour from any step", () => {
    mountAnchors();
    const onFinish = vi.fn();
    render(<ProductTour onFinish={onFinish} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("skips a step whose real target isn't on screen, rather than pointing at nothing", async () => {
    // Composer missing entirely — e.g. a document viewer is open instead of chat.
    const sidebar = document.createElement("button");
    sidebar.setAttribute("data-tour", "sidebar-brand");
    stubRect(sidebar, { left: 10, top: 10, right: 60, bottom: 40, width: 50, height: 30 });
    const contextPanel = document.createElement("aside");
    contextPanel.setAttribute("data-tour", "context-panel");
    stubRect(contextPanel, { left: 900, top: 10, right: 1000, bottom: 400, width: 100, height: 390 });
    document.body.append(sidebar, contextPanel);

    const user = userEvent.setup();
    render(<ProductTour onFinish={vi.fn()} />);
    expect(screen.getByText("This is Newton")).toBeInTheDocument();

    // Next from step 1 should land directly on step 3 (context panel) — step 2
    // (composer) has no real element on screen, so it's skipped, not shown broken.
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("It remembers your semester")).toBeInTheDocument();
  });

  it("finishes immediately (renders nothing) when none of its real targets exist", () => {
    const onFinish = vi.fn();
    const { container } = render(<ProductTour onFinish={onFinish} />);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });
});
