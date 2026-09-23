import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AppWalkthrough from "./AppWalkthrough";

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

/** Reports "in view" the moment observe() is called (jsdom has no IntersectionObserver,
 * and useInView's fallbackInView: false would otherwise never start playback). */
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
    vi.mocked(window.HTMLMediaElement.prototype.play).mockClear();
    vi.mocked(window.HTMLMediaElement.prototype.pause).mockClear();
    // @ts-expect-error -- test-only cleanup of the stubs installed above
    delete window.matchMedia;
    // @ts-expect-error -- test-only cleanup of the stub installed above
    delete window.IntersectionObserver;
  });

  it("is ONE film — a single video, with no step tabs, arrows, or slides", () => {
    mockInView();
    render(<AppWalkthrough />);
    expect(document.querySelectorAll("video")).toHaveLength(1);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /next step|previous step/i })).not.toBeInTheDocument();
  });

  it("plays the real promo film, muted and looping, with a poster", () => {
    mockInView();
    render(<AppWalkthrough />);
    const video = document.querySelector("video")!;
    expect(video).toHaveAttribute("src", "/demo/newton-promo.mp4");
    expect(video).toHaveAttribute("poster", "/demo/newton-promo-poster.jpg");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video).toHaveAttribute("playsinline");
  });

  it("autoplays once scrolled into view", () => {
    mockInView();
    render(<AppWalkthrough />);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("does not autoplay off screen", () => {
    render(<AppWalkthrough />);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("clicking the video toggles pause/play", () => {
    mockInView();
    render(<AppWalkthrough />);
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    fireEvent.click(video);
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("shows an explicit Play button while paused, and hides it once playing", () => {
    mockInView();
    render(<AppWalkthrough />);
    expect(screen.getByRole("button", { name: /play the film/i })).toBeInTheDocument();
    fireEvent.play(document.querySelector("video")!);
    expect(screen.queryByRole("button", { name: /play the film/i })).not.toBeInTheDocument();
  });

  it("never autoplays under prefers-reduced-motion, but still offers a Play button", () => {
    mockReducedMotion(true);
    mockInView();
    render(<AppWalkthrough />);
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /play the film/i })).toBeInTheDocument();
  });
});
