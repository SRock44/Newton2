import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FaqPage from "./page";

describe("FaqPage", () => {
  it("renders the page heading", () => {
    render(<FaqPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /frequently asked questions/i })
    ).toBeInTheDocument();
  });

  it("answers honestly instead of inventing a free-tier number", () => {
    render(<FaqPage />);
    expect(screen.getByText("Is it free?")).toBeInTheDocument();
    expect(screen.getByText(/about 5 items/i)).toBeInTheDocument();
    expect(screen.getByText(/about 15 on pro/i)).toBeInTheDocument();
  });

  it("does not overclaim on data privacy or link to a finished policy", () => {
    render(<FaqPage />);
    expect(screen.getByText("Is my data private?")).toBeInTheDocument();
    expect(
      screen.getByText(/don't yet have a finished, lawyer-reviewed privacy policy/i)
    ).toBeInTheDocument();
  });

  it("answers the offline question honestly (cloud-backed, no offline mode)", () => {
    render(<FaqPage />);
    expect(screen.getByText(/does it work without an internet connection/i)).toBeInTheDocument();
    expect(screen.getByText(/^No\. Newton's tutor/)).toBeInTheDocument();
  });

  it("grounds \"verified, not vibes\" in real, specific tool examples", () => {
    render(<FaqPage />);
    expect(screen.getByText(/real symbolic algebra \(sympy\)/i)).toBeInTheDocument();
    expect(screen.getByText(/real tests in a sandbox/i)).toBeInTheDocument();
  });
});
