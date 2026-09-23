import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EngineerWalkthrough from "./EngineerWalkthrough";

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

/** Reports "in view" the moment observe() is called (jsdom has no IntersectionObserver). */
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

describe("EngineerWalkthrough", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(window.HTMLMediaElement.prototype.play).mockClear();
    vi.mocked(window.HTMLMediaElement.prototype.pause).mockClear();
    // @ts-expect-error -- test-only cleanup of the stubs installed by the tests
    delete window.matchMedia;
    // @ts-expect-error -- test-only cleanup of the stub installed by the tests
    delete window.IntersectionObserver;
  });

  it("is one film for the engineering student, with its own poster, muted and looping", () => {
    render(<EngineerWalkthrough />);
    const videos = document.querySelectorAll("video");
    expect(videos).toHaveLength(1);
    const video = videos[0];
    expect(video).toHaveAttribute("src", "/demo/newton-engineering.mp4");
    expect(video).toHaveAttribute("poster", "/demo/newton-engineering-poster.jpg");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video).toHaveAttribute("playsinline");
  });

  it("frames the film as learning, not answer-getting", () => {
    render(<EngineerWalkthrough />);
    expect(screen.getByRole("heading", { level: 2, name: /push back/i })).toBeInTheDocument();
    expect(screen.getByText(/never just handed it/i)).toBeInTheDocument();
  });

  it("does not autoplay off screen", () => {
    render(<EngineerWalkthrough />);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("autoplays once scrolled into view", () => {
    window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
    render(<EngineerWalkthrough />);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("never autoplays under prefers-reduced-motion, but still offers a Play button", () => {
    mockReducedMotion(true);
    window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
    render(<EngineerWalkthrough />);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /play the film/i })).toBeInTheDocument();
    fireEvent.play(document.querySelector("video")!);
    expect(screen.queryByRole("button", { name: /play the film/i })).not.toBeInTheDocument();
  });
});
