import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("renders the Newton wordmark in both the header and footer", () => {
    render(<Home />);
    expect(screen.getAllByText("Newton").length).toBeGreaterThanOrEqual(2);
  });

  describe("header / nav", () => {
    it("renders a real primary nav with functional-looking links", () => {
      render(<Home />);
      const nav = screen.getByRole("navigation", { name: /primary/i });
      expect(within(nav).getByRole("link", { name: "Features" })).toBeInTheDocument();
      expect(within(nav).getByRole("link", { name: "For Students" })).toBeInTheDocument();
      expect(within(nav).getByRole("link", { name: "Download" })).toBeInTheDocument();
    });

    it("renders Sign In and Sign Up entry points", () => {
      render(<Home />);
      // Both appear twice by design: once in the header, once in the footer.
      expect(screen.getAllByRole("link", { name: "Sign In" }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: "Sign Up" }).length).toBeGreaterThan(0);
    });
  });

  describe("hero", () => {
    it("renders a real headline and value-prop subhead, not a single placeholder line", () => {
      render(<Home />);
      expect(
        screen.getByRole("heading", { level: 1, name: /checks its work/i })
      ).toBeInTheDocument();
      expect(screen.getByText(/native desktop study companion/i)).toBeInTheDocument();
    });

    it("renders a visible primary download CTA", () => {
      render(<Home />);
      expect(screen.getAllByRole("link", { name: /download newton/i }).length).toBeGreaterThan(
        0
      );
    });

    it("does not claim sign-up/download are wired up yet (Phase 4, not built)", () => {
      render(<Home />);
      const downloadLinks = screen.getAllByRole("link", { name: /download newton/i });
      for (const link of downloadLinks) {
        expect(link).toHaveAttribute("href", "#");
      }
    });
  });

  describe("verified, not vibes section", () => {
    it("shows concrete, specific worked examples rather than generic AI-powered language", () => {
      render(<Home />);
      // "Factor x² + 5x + 6" appears twice by design: once in the hero mock card,
      // once in the worked-example card below it.
      expect(screen.getAllByText(/factor x. \+ 5x \+ 6/i).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("(x + 2)(x + 3)")).toBeInTheDocument();
      expect(screen.getByText(/balance c.h. \+ o./i)).toBeInTheDocument();
    });

    it("labels each worked example with a verified/grounding badge", () => {
      render(<Home />);
      expect(screen.getAllByText(/verified — real symbolic computation/i).length).toBeGreaterThan(
        0
      );
      expect(screen.getByText("Grounding checked")).toBeInTheDocument();
    });

    it("honestly distinguishes computed verification from reasoning-based critique", () => {
      render(<Home />);
      expect(screen.getByText(/no algorithm for deciding something/i)).toBeInTheDocument();
    });
  });

  describe("feature groups", () => {
    it("organizes real capabilities into named groups, not a flat bullet dump", () => {
      render(<Home />);
      expect(screen.getByText("Verified Computation")).toBeInTheDocument();
      expect(screen.getByText("Real Memory & Progress Tracking")).toBeInTheDocument();
      expect(screen.getByText("Real Document Understanding")).toBeInTheDocument();
      expect(screen.getByText("Honest by Design")).toBeInTheDocument();
      expect(screen.getByText("Real Language Practice")).toBeInTheDocument();
    });

    it("grounds the Verified Computation group in real, specific tool capability", () => {
      render(<Home />);
      expect(screen.getByText(/symbolic math & linear algebra/i)).toBeInTheDocument();
      expect(screen.getByText(/checks your code and your proofs/i)).toBeInTheDocument();
    });

    it("names the FSRS spaced-repetition mechanism and the weak-areas engine specifically", () => {
      render(<Home />);
      expect(screen.getByText(/fsrs-scheduled flashcards/i)).toBeInTheDocument();
      expect(screen.getByText(/weak-areas engine that closes the loop/i)).toBeInTheDocument();
    });

    it("describes server-enforced Focus Mode, not just a prompt asking nicely", () => {
      render(<Home />);
      expect(screen.getByText(/server-enforced focus mode/i)).toBeInTheDocument();
      expect(screen.getByText(/not a politely-asked model/i)).toBeInTheDocument();
    });
  });

  describe("the Notepad-in-class section", () => {
    it("tells a concrete classroom scenario, not an abstract feature blurb", () => {
      render(<Home />);
      expect(
        screen.getByRole("heading", { name: /take live lecture notes/i })
      ).toBeInTheDocument();
      expect(screen.getByText(/you're in lecture/i)).toBeInTheDocument();
      expect(screen.getByText(/highlight it right there in your notes/i)).toBeInTheDocument();
    });

    it("renders a mock note card showing highlight-to-explain in context", () => {
      render(<Home />);
      expect(screen.getByText(/lecture 14/i)).toBeInTheDocument();
      expect(screen.getByText(/the coercive field is path-dependent/i)).toBeInTheDocument();
      expect(screen.getByText("Explain this")).toBeInTheDocument();
    });
  });

  describe("built for every student section", () => {
    it("renders per-major cards grounded in the real critique-review findings", () => {
      render(<Home />);
      expect(screen.getByText("Math")).toBeInTheDocument();
      expect(screen.getByText("Computer Science")).toBeInTheDocument();
      expect(screen.getByText("Engineering & Natural Sciences")).toBeInTheDocument();
      expect(screen.getByText("Social Sciences")).toBeInTheDocument();
      expect(screen.getByText("Humanities")).toBeInTheDocument();
      expect(screen.getByText("World Languages")).toBeInTheDocument();
    });

    it("grounds the Computer Science card in the real check-don't-write distinction", () => {
      render(<Home />);
      expect(screen.getByText(/checks your code\. never writes it for you\./i)).toBeInTheDocument();
    });

    it("mentions bare-topic generation for self-directed/test-prep students", () => {
      render(<Home />);
      expect(screen.getByText(/starting from zero, or grinding for a test/i)).toBeInTheDocument();
    });
  });

  describe("footer", () => {
    it("renders a real, structured footer with multiple link columns, not just a wordmark", () => {
      render(<Home />);
      const footer = screen.getByRole("contentinfo");
      expect(within(footer).getByText("Product")).toBeInTheDocument();
      expect(within(footer).getByText("Account")).toBeInTheDocument();
      expect(within(footer).getByText("Company")).toBeInTheDocument();
      expect(within(footer).getAllByRole("link").length).toBeGreaterThanOrEqual(6);
    });
  });
});
