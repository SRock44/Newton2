import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import ThinkingIndicator from "../ThinkingIndicator";

describe("ThinkingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders with the accessible 'Newton is thinking' label existing tests/App.tsx rely on", () => {
    render(<ThinkingIndicator />);
    expect(screen.getByLabelText("Newton is thinking")).toBeInTheDocument();
  });

  it("shows the first phrase immediately, with no wait", () => {
    render(<ThinkingIndicator />);
    expect(screen.getByText("Newton is thinking…")).toBeInTheDocument();
  });

  it("cycles to a different phrase over time, purely client-side", () => {
    render(<ThinkingIndicator />);
    expect(screen.getByText("Newton is thinking…")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(screen.getByText("Reading your message…")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(screen.getByText("Working through it…")).toBeInTheDocument();
  });

  it("wraps back around to the first phrase after cycling through all of them", () => {
    render(<ThinkingIndicator />);
    act(() => {
      vi.advanceTimersByTime(2600 * 4);
    });
    expect(screen.getByText("Newton is thinking…")).toBeInTheDocument();
  });

  it("stops cycling once unmounted, without throwing (no state update after unmount)", () => {
    const { unmount } = render(<ThinkingIndicator />);
    unmount();
    expect(() => act(() => vi.advanceTimersByTime(10_000))).not.toThrow();
  });
});
