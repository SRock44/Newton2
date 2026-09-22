import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RoadmapPage from "./page";

describe("RoadmapPage", () => {
  it("renders the page heading", () => {
    render(<RoadmapPage />);
    expect(screen.getByRole("heading", { level: 1, name: /^roadmap$/i })).toBeInTheDocument();
  });

  it("frames every item honestly as planned, never as already shipped", () => {
    render(<RoadmapPage />);
    const badges = screen.getAllByText("Planned");
    expect(badges.length).toBeGreaterThanOrEqual(6);
  });

  it("grounds items in ROADMAP.md's real deferred/planned list", () => {
    render(<RoadmapPage />);
    expect(screen.getByText(/full web-based chat client/i)).toBeInTheDocument();
    expect(screen.getByText(/try it live/i)).toBeInTheDocument();
    expect(screen.getByText(/review reminders as real os notifications/i)).toBeInTheDocument();
  });

  it("never claims a specific delivery date", () => {
    render(<RoadmapPage />);
    expect(screen.queryByText(/\bQ[1-4]\s?2026\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bcoming (this|next) (month|quarter)\b/i)).not.toBeInTheDocument();
  });
});
