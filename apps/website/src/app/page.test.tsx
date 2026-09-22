import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("renders the Newton wordmark", () => {
    render(<Home />);
    expect(screen.getAllByText("Newton").length).toBeGreaterThan(0);
  });

  it("renders the product description grounded in the real README copy", () => {
    render(<Home />);
    expect(screen.getByText(/Agentic Learning Environment/i)).toBeInTheDocument();
    expect(screen.getByText(/reads your syllabus/i)).toBeInTheDocument();
  });

  it("does not claim sign-up/download exist yet (Phase 4, not built)", () => {
    render(<Home />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
