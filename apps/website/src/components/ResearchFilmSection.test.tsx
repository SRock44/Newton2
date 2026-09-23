import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ResearchFilmSection from "./ResearchFilmSection";

describe("ResearchFilmSection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error -- test-only cleanup
    delete window.matchMedia;
  });

  it("is a separate, higher-level film: one muted, looping video with a poster", () => {
    render(<ResearchFilmSection />);
    const videos = document.querySelectorAll("video");
    expect(videos).toHaveLength(1);
    const video = videos[0];
    expect(video).toHaveAttribute("src", "/demo/newton-research.mp4");
    expect(video).toHaveAttribute("poster", "/demo/newton-research-poster.jpg");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
  });

  it("says Newton works at every level and describes the paper", () => {
    render(<ResearchFilmSection />);
    expect(screen.getByRole("heading", { name: /from messy notes to a real paper/i })).toBeInTheDocument();
    expect(screen.getByText(/works at every level/i)).toBeInTheDocument();
    expect(document.querySelector("#demo-research")).not.toBeNull();
  });
});
