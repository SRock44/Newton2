import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
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
      expect(within(nav).getByRole("link", { name: "Pro" })).toBeInTheDocument();
      expect(within(nav).getByRole("link", { name: "FAQ" })).toBeInTheDocument();
    });

    it("links FAQ and Pro to real internal destinations, not stubs", () => {
      render(<Home />);
      const nav = screen.getByRole("navigation", { name: /primary/i });
      expect(within(nav).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faq");
      expect(within(nav).getByRole("link", { name: "Pro" })).toHaveAttribute("href", "/#pro");
    });

    it("renders Sign In and Sign Up entry points", () => {
      render(<Home />);
      // Both appear at least once outside the (initially closed) mobile menu: once in
      // the header, once in the footer's... actually the footer no longer repeats them
      // (Phase 3.8 drops the redundant Account column) — just the header.
      expect(screen.getAllByRole("link", { name: "Sign In" }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: "Sign Up" }).length).toBeGreaterThan(0);
    });

    it("has a working mobile menu that reveals Features/Pro/FAQ/Sign In (Phase 3.8 fix: previously unreachable below 720px)", () => {
      render(<Home />);
      const toggle = screen.getByRole("button", { name: /open menu/i });
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      // Before opening, the mobile-only nav panel isn't rendered at all.
      expect(screen.queryByRole("navigation", { name: /mobile/i })).not.toBeInTheDocument();

      fireEvent.click(toggle);

      const mobileNav = screen.getByRole("navigation", { name: /mobile/i });
      expect(within(mobileNav).getByRole("link", { name: "Features" })).toBeInTheDocument();
      expect(within(mobileNav).getByRole("link", { name: "Pro" })).toBeInTheDocument();
      expect(within(mobileNav).getByRole("link", { name: "FAQ" })).toBeInTheDocument();
      expect(within(mobileNav).getByRole("link", { name: "Sign In" })).toBeInTheDocument();
      expect(within(mobileNav).getByRole("link", { name: "Sign Up" })).toBeInTheDocument();

      expect(screen.getByRole("button", { name: /close menu/i })).toHaveAttribute(
        "aria-expanded",
        "true"
      );
    });
  });

  describe("hero", () => {
    it("renders a real headline and value-prop subhead, not a single placeholder line", () => {
      render(<Home />);
      expect(
        screen.getByRole("heading", { level: 1, name: /checks its work/i })
      ).toBeInTheDocument();
      expect(screen.getByText(/instead of an llm guessing/i)).toBeInTheDocument();
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

    it("mentions the free-to-start note (the old separate closing CTA section was cut — this line is now the only place it lives)", () => {
      render(<Home />);
      expect(screen.getByText(/free to start/i)).toBeInTheDocument();
    });
  });

  describe("the real app demo (product owner: demo must be on the landing page, not scrolled to)", () => {
    it("renders immediately after the hero, before every other section", () => {
      render(<Home />);
      const headings = screen.getAllByRole("heading", { level: 1 }).concat(
        screen.getAllByRole("heading", { level: 2 })
      );
      const headingTexts = headings.map((h) => h.textContent ?? "");
      const heroIndex = headingTexts.findIndex((t) => /checks its work/i.test(t));
      const demoIndex = headingTexts.findIndex((t) => /this is the app/i.test(t));
      const verifiedIndex = headingTexts.findIndex((t) => /not vibes/i.test(t));
      const featuresIndex = headingTexts.findIndex((t) => /what it does/i.test(t));
      expect(heroIndex).toBeGreaterThanOrEqual(0);
      expect(demoIndex).toBeGreaterThan(heroIndex);
      // The demo comes immediately after the hero — before the graded-paper section and
      // every later section — not scrolled-to further down the page.
      expect(demoIndex).toBeLessThan(verifiedIndex);
      expect(demoIndex).toBeLessThan(featuresIndex);
    });

    it("renders the real desktop app's window chrome: title bar, sidebar, and a real uploaded document", () => {
      render(<Home />);
      expect(screen.getAllByText("Newton").length).toBeGreaterThanOrEqual(3); // header, demo titlebar, demo sidebar
      expect(
        screen.getByRole("button", { name: /physics 201 - lecture 14\.txt/i })
      ).toBeInTheDocument();
    });
  });

  describe("verified, not vibes section (the graded-paper visual)", () => {
    it("shows the real math-catches-mistake worked example as a marked-up page, not a generic card", () => {
      render(<Home />);
      expect(screen.getByText("Factor x² + 5x + 6")).toBeInTheDocument();
      expect(screen.getByText("(x + 1)(x + 6)")).toBeInTheDocument();
      expect(screen.getByText("(x + 2)(x + 3)")).toBeInTheDocument();
      expect(screen.getByText(/1 \+ 6 = 7, not 5/i)).toBeInTheDocument();
    });

    it("marks the correction with a real Verified stamp", () => {
      render(<Home />);
      // "Verified" also appears in the "Verified, not vibes" heading itself, so this
      // checks the stamp's own second line (unique to it) alongside at least one
      // "Verified" text on the page.
      expect(screen.getByText("real symbolic computation")).toBeInTheDocument();
      expect(screen.getAllByText("Verified").length).toBeGreaterThan(0);
    });

    it("keeps chemistry/code/citations as one short line, not a repeated card pattern (Phase 3.8 cut the old 'also verified' strip + footnote)", () => {
      render(<Home />);
      expect(
        screen.getByText(/the same standard applies to chemistry, your code, and citations/i)
      ).toBeInTheDocument();
    });
  });

  describe("capability list (Phase 3.8: replaces the old 13-card, 5-subgroup feature grid)", () => {
    it("renders a tight single-line-per-item list, not a card grid", () => {
      render(<Home />);
      expect(screen.getByRole("heading", { name: /what it does/i })).toBeInTheDocument();
      expect(
        screen.getByText(/symbolic math, linear algebra, chemistry, and statistics/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/fsrs-scheduled flashcards, practice exams, and a weak-areas engine/i)
      ).toBeInTheDocument();
    });

    it("describes server-enforced Focus Mode, not just a prompt asking nicely", () => {
      render(<Home />);
      expect(screen.getByText(/focus mode holds back the answer until you ask/i)).toBeInTheDocument();
      expect(screen.getByText(/not politely requested of the model/i)).toBeInTheDocument();
    });
  });

  describe("the Notepad-in-class section", () => {
    it("renders the shortened heading + one-sentence description", () => {
      render(<Home />);
      expect(
        screen.getByRole("heading", { name: /notes that don't stop when you get confused/i })
      ).toBeInTheDocument();
      expect(
        screen.getByText(/highlight anything in your notes and ask newton to explain/i)
      ).toBeInTheDocument();
    });

    it("renders a mock note card showing highlight-to-explain in context", () => {
      render(<Home />);
      // "Lecture 14" alone also matches the real app demo's document filename
      // ("Physics 201 - Lecture 14.txt") elsewhere on the page — match the notepad
      // card's own title text specifically.
      expect(screen.getByText(/lecture 14 — electromagnetism/i)).toBeInTheDocument();
      expect(screen.getByText(/the coercive field is path-dependent/i)).toBeInTheDocument();
      expect(screen.getByText("Explain this")).toBeInTheDocument();
    });
  });

  describe("footer", () => {
    it("renders a compact footer without a redundant Account column", () => {
      render(<Home />);
      const footer = screen.getByRole("contentinfo");
      expect(within(footer).getByText("Product")).toBeInTheDocument();
      expect(within(footer).getByText("Company")).toBeInTheDocument();
      expect(within(footer).queryByText("Account")).not.toBeInTheDocument();
      expect(within(footer).queryByRole("link", { name: "Sign In" })).not.toBeInTheDocument();
      expect(within(footer).queryByRole("link", { name: "Sign Up" })).not.toBeInTheDocument();
    });

    it("doesn't repeat the primary nav's Features/Pro links in the Product column", () => {
      render(<Home />);
      const footer = screen.getByRole("contentinfo");
      expect(within(footer).queryByRole("link", { name: "Features" })).not.toBeInTheDocument();
      expect(within(footer).queryByRole("link", { name: "Pro" })).not.toBeInTheDocument();
    });

    it("links About/FAQ/Changelog/Roadmap to real internal routes, not '#' stubs", () => {
      render(<Home />);
      const footer = screen.getByRole("contentinfo");
      expect(within(footer).getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
      expect(within(footer).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faq");
      expect(within(footer).getByRole("link", { name: "Changelog" })).toHaveAttribute(
        "href",
        "/changelog"
      );
      expect(within(footer).getByRole("link", { name: "Roadmap" })).toHaveAttribute(
        "href",
        "/roadmap"
      );
    });
  });

  describe("Pro features section", () => {
    it("lists real Pro-exclusive tools with no invented price", () => {
      render(<Home />);
      expect(screen.getByText("Full research paper writing")).toBeInTheDocument();
      expect(screen.getByText("Deep Research")).toBeInTheDocument();
      expect(screen.getByText(/access to frontier ai models/i)).toBeInTheDocument();
      // No dollar figure anywhere in the section — the real Pro price isn't known to this codebase.
      expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    });

    it("does not apologize/over-explain the missing price (Phase 3.8 cut that footnote)", () => {
      render(<Home />);
      expect(screen.queryByText(/no price shown here on purpose/i)).not.toBeInTheDocument();
    });

    it("shows Pro feature titles only, no per-feature body paragraph", () => {
      render(<Home />);
      expect(
        screen.queryByText(/a plan-then-approve workflow that compiles/i)
      ).not.toBeInTheDocument();
    });

    it("caps the free-tier list at 3 items", () => {
      render(<Home />);
      const proSection = document.getElementById("pro");
      expect(proSection).not.toBeNull();
      const freeList = within(proSection as HTMLElement).getByText("Free").closest("div");
      const items = within(freeList as HTMLElement).getAllByRole("listitem");
      expect(items.length).toBeLessThanOrEqual(3);
    });

    it("has an Upgrade to Pro CTA (stubbed to '#' — checkout isn't built yet)", () => {
      render(<Home />);
      const upgradeLink = screen.getByRole("link", { name: /upgrade to pro/i });
      expect(upgradeLink).toHaveAttribute("href", "#");
    });
  });

  describe("cut sections (Phase 3.8)", () => {
    it("no longer renders the 'For Students' section (pure duplication of the capability list)", () => {
      render(<Home />);
      expect(screen.queryByText(/built for every student/i)).not.toBeInTheDocument();
      expect(screen.queryByText("World Languages")).not.toBeInTheDocument();
    });

    it("no longer renders a separate closing CTA section (redundant with the hero CTA)", () => {
      render(<Home />);
      expect(
        screen.queryByText(/study with something that checks its work/i)
      ).not.toBeInTheDocument();
    });
  });

  describe("copy voice (Phase 3.8 rewrite)", () => {
    it("uses the new, shorter hero subhead", () => {
      render(<Home />);
      expect(
        screen.getByText(
          /newton solves problems with real tools — symbolic math, chemistry, statistics, your own code — instead of an llm guessing\. it remembers your whole semester\./i
        )
      ).toBeInTheDocument();
    });

    it("uses the new 'Other AI tutors guess. Newton grades.' line", () => {
      render(<Home />);
      expect(screen.getByText(/other ai tutors guess\. newton grades\./i)).toBeInTheDocument();
    });
  });
});
