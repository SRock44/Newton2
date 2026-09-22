import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ChangelogPage from "./page";

describe("ChangelogPage", () => {
  it("renders the page heading", () => {
    render(<ChangelogPage />);
    expect(screen.getByRole("heading", { level: 1, name: /changelog/i })).toBeInTheDocument();
  });

  it("presents real, specific shipped features in plain language, no internal phase numbers", () => {
    render(<ChangelogPage />);
    expect(screen.getByText(/verified.*badge is now real and server-checked/i)).toBeInTheDocument();
    expect(screen.getByText(/spaced-repetition flashcards/i)).toBeInTheDocument();
    expect(screen.getByText(/deep research/i)).toBeInTheDocument();
    // No leaked internal engineering framing anywhere in the list.
    expect(screen.queryByText(/phase \d/i)).not.toBeInTheDocument();
  });

  it("lists a real number of entries, not a token placeholder", () => {
    render(<ChangelogPage />);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(15);
  });
});
