import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AppWalkthrough from "./AppWalkthrough";

/** Stubs `window.matchMedia("(prefers-reduced-motion: reduce)")`, same convention the
 * rest of this codebase's animated components use. */
function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** A minimal real IntersectionObserver stub that reports "in view" the moment
 * `observe()` is called — jsdom has no real implementation, and useInView's
 * `fallbackInView: false` means the walkthrough's auto-advance engine (deliberately
 * gated on real scroll-into-view, not just a manual interaction) would otherwise never
 * start in a test environment at all. */
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function mockInView() {
  window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
}

describe("AppWalkthrough", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    // @ts-expect-error -- test-only cleanup of the stubs installed above
    delete window.matchMedia;
    // @ts-expect-error -- test-only cleanup of the stub installed above
    delete window.IntersectionObserver;
  });

  it("shows the real graded-paper Study Mode scene by default, with 3 step controls", () => {
    render(<AppWalkthrough />);
    expect(screen.getByText("Factor x² + 5x + 6")).toBeInTheDocument();
    expect(
      screen.getByText(/can you find a different pair of numbers that multiply to 6/i)
    ).toBeInTheDocument();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("manual Next/Prev controls step through all three scenes", () => {
    render(<AppWalkthrough />);
    const next = screen.getByRole("button", { name: /next step/i });
    const prev = screen.getByRole("button", { name: /previous step/i });
    expect(prev).toBeDisabled();

    fireEvent.click(next);
    expect(screen.getByText(/lecture 14 — electromagnetism/i)).toBeInTheDocument();

    fireEvent.click(next);
    expect(
      screen.getByText(/build me an interactive artifact that teaches the unit circle/i)
    ).toBeInTheDocument();
    expect(next).toBeDisabled();

    fireEvent.click(prev);
    expect(screen.getByText(/lecture 14 — electromagnetism/i)).toBeInTheDocument();
  });

  it("clicking a step segment jumps directly to that scene", () => {
    render(<AppWalkthrough />);
    fireEvent.click(screen.getByRole("tab", { name: /step 3: artifact generation/i }));

    const frame = screen.getByTitle(/live artifact: the unit circle/i);
    expect(frame).toHaveAttribute("src", "/demo/unit-circle-artifact.html");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(screen.getByText("Building your interactive demo")).toBeInTheDocument();
  });

  it("auto-advances through scene 0 -> 1 -> 2 on real timers, then stops (no forced loop back)", async () => {
    mockReducedMotion(false);
    mockInView();
    vi.useFakeTimers();

    render(<AppWalkthrough />);
    expect(screen.getByText("Factor x² + 5x + 6")).toBeInTheDocument();

    // Scene 0's duration (7000ms) plus a margin.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7300);
    });
    expect(screen.getByText(/lecture 14 — electromagnetism/i)).toBeInTheDocument();

    // Scene 1's duration (5500ms) plus a margin.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5800);
    });
    expect(
      screen.getByText(/build me an interactive artifact that teaches the unit circle/i)
    ).toBeInTheDocument();

    // Scene 2 is terminal: even after a long additional wait, it must not loop back to
    // scene 0.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(
      screen.getByText(/build me an interactive artifact that teaches the unit circle/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("Factor x² + 5x + 6")).not.toBeInTheDocument();
  });

  it("pauses auto-advance on hover and resumes on mouse-leave", async () => {
    mockReducedMotion(false);
    mockInView();
    vi.useFakeTimers();

    render(<AppWalkthrough />);
    const stage = screen.getByRole("tablist", { name: /walkthrough steps/i }).parentElement!;

    fireEvent.mouseEnter(stage);
    // Well past scene 0's real 7000ms duration — should NOT have advanced while hovered.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.getByText("Factor x² + 5x + 6")).toBeInTheDocument();

    fireEvent.mouseLeave(stage);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7300);
    });
    expect(screen.getByText(/lecture 14 — electromagnetism/i)).toBeInTheDocument();
  });

  it("does not auto-advance at all under prefers-reduced-motion", async () => {
    mockReducedMotion(true);
    mockInView();
    vi.useFakeTimers();

    render(<AppWalkthrough />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(screen.getByText("Factor x² + 5x + 6")).toBeInTheDocument();

    // Manual navigation still works under reduced motion.
    fireEvent.click(screen.getByRole("button", { name: /next step/i }));
    expect(screen.getByText(/lecture 14 — electromagnetism/i)).toBeInTheDocument();
  });
});
