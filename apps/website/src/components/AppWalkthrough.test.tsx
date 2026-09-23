import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
 * `fallbackInView: false` means the walkthrough would otherwise never consider itself
 * on-screen (and so never autoplay) in a test environment at all. */
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
    // @ts-expect-error -- test-only cleanup of the stub installed above
    delete window.matchMedia;
    // @ts-expect-error -- test-only cleanup of the stub installed above
    delete window.IntersectionObserver;
  });

  it("shows the real Study Mode screen recording by default, with 3 step tabs", () => {
    mockInView();
    render(<AppWalkthrough />);
    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "/demo/videos/study.mp4");

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAccessibleName(/step 1: newton catches the mistake/i);
  });

  it("manual Next/Prev controls step through all three real scenes", () => {
    mockInView();
    render(<AppWalkthrough />);
    const next = screen.getByRole("button", { name: /next step/i });
    const prev = screen.getByRole("button", { name: /previous step/i });
    expect(prev).toBeDisabled();

    fireEvent.click(next);
    expect(document.querySelector("video")).toHaveAttribute("src", "/demo/videos/notepad.mp4");

    fireEvent.click(next);
    expect(document.querySelector("video")).toHaveAttribute("src", "/demo/videos/artifact.mp4");
    expect(next).toBeDisabled();

    fireEvent.click(prev);
    expect(document.querySelector("video")).toHaveAttribute("src", "/demo/videos/notepad.mp4");
  });

  it("clicking a step tab jumps directly to that scene", () => {
    mockInView();
    render(<AppWalkthrough />);
    fireEvent.click(screen.getByRole("tab", { name: /step 3: newton builds the visual/i }));
    expect(document.querySelector("video")).toHaveAttribute("src", "/demo/videos/artifact.mp4");
  });

  it("a real video 'ended' event advances to the next scene (no fake timer driving it)", () => {
    mockInView();
    render(<AppWalkthrough />);
    const video = document.querySelector("video")!;

    fireEvent.ended(video);
    expect(document.querySelector("video")).toHaveAttribute("src", "/demo/videos/notepad.mp4");

    fireEvent.ended(document.querySelector("video")!);
    expect(document.querySelector("video")).toHaveAttribute("src", "/demo/videos/artifact.mp4");
  });

  it("scene 3's clip hands off to the real live artifact iframe once it ends, and does not loop back", () => {
    mockInView();
    render(<AppWalkthrough />);
    fireEvent.click(screen.getByRole("tab", { name: /step 3: newton builds the visual/i }));
    fireEvent.ended(document.querySelector("video")!);

    const frame = screen.getByTitle(/live artifact: the unit circle/i);
    expect(frame).toHaveAttribute("src", "/demo/unit-circle-artifact.html");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(document.querySelector("video")).not.toBeInTheDocument();
  });

  it("pauses the real video on hover and resumes on mouse-leave", () => {
    mockInView();
    render(<AppWalkthrough />);
    const stage = screen.getByRole("tablist", { name: /walkthrough steps/i }).parentElement!;
    const video = document.querySelector("video")!;
    const pauseSpy = vi.spyOn(video, "pause");
    const playSpy = vi.spyOn(video, "play");

    fireEvent.mouseEnter(stage);
    expect(pauseSpy).toHaveBeenCalled();

    fireEvent.mouseLeave(stage);
    expect(playSpy).toHaveBeenCalled();
  });

  it("renders a static poster image (no autoplaying video) under prefers-reduced-motion", () => {
    mockReducedMotion(true);
    mockInView();
    render(<AppWalkthrough />);
    expect(document.querySelector("video")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/demo/videos/study-poster.jpg");

    // Manual navigation still works under reduced motion.
    fireEvent.click(screen.getByRole("button", { name: /next step/i }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/demo/videos/notepad-poster.jpg");
  });

  it("under reduced motion, scene 3 shows the real live artifact directly rather than a poster", () => {
    mockReducedMotion(true);
    mockInView();
    render(<AppWalkthrough />);
    fireEvent.click(screen.getByRole("tab", { name: /step 3: newton builds the visual/i }));

    const frame = screen.getByTitle(/live artifact: the unit circle/i);
    expect(frame).toHaveAttribute("src", "/demo/unit-circle-artifact.html");
    expect(document.querySelector("video")).not.toBeInTheDocument();
  });
});
