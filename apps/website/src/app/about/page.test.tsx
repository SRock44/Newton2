import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AboutPage from "./page";

describe("AboutPage", () => {
  it("renders the page heading", () => {
    render(<AboutPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /agentic learning environment/i })
    ).toBeInTheDocument();
  });

  it("grounds the mission in real, specific mechanisms rather than generic AI language", () => {
    render(<AboutPage />);
    expect(screen.getByText(/real symbolic algebra \(sympy\)/i)).toBeInTheDocument();
    expect(screen.getByText(/focus mode/i)).toBeInTheDocument();
    expect(screen.getByText(/check_code_work/i)).toBeInTheDocument();
    expect(screen.getByText(/fsrs/i)).toBeInTheDocument();
  });

  it("never names a fabricated team member, founding year, or company history", () => {
    render(<AboutPage />);
    expect(screen.queryByText(/founded in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/our team/i)).not.toBeInTheDocument();
  });

  it("links out to the changelog and roadmap", () => {
    render(<AboutPage />);
    const changelogLinks = screen.getAllByRole("link", { name: /changelog/i });
    expect(changelogLinks.some((link) => link.getAttribute("href") === "/changelog")).toBe(true);
    const roadmapLinks = screen.getAllByRole("link", { name: /roadmap/i });
    expect(roadmapLinks.some((link) => link.getAttribute("href") === "/roadmap")).toBe(true);
  });
});
