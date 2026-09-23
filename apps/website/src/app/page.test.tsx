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

    it("links Features/FAQ/Pro to real internal destinations, not stubs", () => {
      render(<Home />);
      const nav = screen.getByRole("navigation", { name: /primary/i });
      expect(within(nav).getByRole("link", { name: "Features" })).toHaveAttribute(
        "href",
        "/#features"
      );
      expect(within(nav).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faq");
      expect(within(nav).getByRole("link", { name: "Pro" })).toHaveAttribute("href", "/#pro");
    });

    it("renders Sign In and Sign Up entry points", () => {
      render(<Home />);
      expect(screen.getAllByRole("link", { name: "Sign In" }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: "Sign Up" }).length).toBeGreaterThan(0);
    });

    it("has a working mobile menu that reveals Features/Pro/FAQ/Sign In", () => {
      render(<Home />);
      const toggle = screen.getByRole("button", { name: /open menu/i });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
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

    it("mentions the free-to-start note", () => {
      render(<Home />);
      expect(screen.getByText(/free to start/i)).toBeInTheDocument();
    });

    it("links the secondary CTA to the walkthrough, not the old removed anchor", () => {
      render(<Home />);
      expect(screen.getByRole("link", { name: /see how it works/i })).toHaveAttribute(
        "href",
        "#demo"
      );
    });
  });

  describe("the app walkthrough (Phase 3.9: replaces the chat-transcript demo, the Verified/GradedPaper section, and the Notepad section)", () => {
    it("renders immediately after the hero, before every other section", () => {
      render(<Home />);
      const headings = screen
        .getAllByRole("heading", { level: 1 })
        .concat(screen.getAllByRole("heading", { level: 2 }));
      const headingTexts = headings.map((h) => h.textContent ?? "");
      const heroIndex = headingTexts.findIndex((t) => /checks its work/i.test(t));
      const demoIndex = headingTexts.findIndex((t) => /this is the app/i.test(t));
      const featuresIndex = headingTexts.findIndex((t) => /what it does/i.test(t));
      expect(heroIndex).toBeGreaterThanOrEqual(0);
      expect(demoIndex).toBeGreaterThan(heroIndex);
      expect(demoIndex).toBeLessThan(featuresIndex);
    });

    it("states the Agentic Learning Environment positioning once, plainly", () => {
      render(<Home />);
      expect(
        screen.getByText(/the first agentic learning environment/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/built to teach you, not do it for you/i)
      ).toBeInTheDocument();
    });

    it("is a single continuous film, not a set of slides", () => {
      render(<Home />);
      const videos = document.querySelectorAll("#demo video");
      expect(videos).toHaveLength(1);
      expect(videos[0]).toHaveAttribute("src", "/demo/newton-showcase.mp4");
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
    });

    it("is the ONLY film on the page — one product video, not a bunch of separate ones", () => {
      render(<Home />);
      expect(document.querySelectorAll("video")).toHaveLength(1);
      expect(document.querySelector("#demo-engineering")).toBeNull();
      expect(document.querySelector("#demo video")).toHaveAttribute(
        "poster",
        "/demo/newton-showcase-poster.jpg"
      );
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

    it("has a real #features anchor for the nav link to land on", () => {
      render(<Home />);
      expect(document.getElementById("features")).not.toBeNull();
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
      expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    });

    it("does not apologize/over-explain the missing price", () => {
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

  describe("cut sections", () => {
    it("no longer renders the 'For Students' section (Phase 3.8, pure duplication of the capability list)", () => {
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

    it("no longer renders the old chat-transcript app-chrome demo (Phase 3.9)", () => {
      render(<Home />);
      expect(screen.queryByText(/a recreation of newton's desktop window/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/real sessions, replayed/i)).not.toBeInTheDocument();
    });

    it("no longer renders the Verified/GradedPaper and Notepad sections as their own separate sections (Phase 3.9: folded into the walkthrough)", () => {
      render(<Home />);
      expect(
        screen.queryByRole("heading", { name: /notes that don't stop when you get confused/i })
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/other ai tutors guess\. newton grades\./i)).not.toBeInTheDocument();
    });
  });

  describe("copy voice", () => {
    it("uses the shorter hero subhead", () => {
      render(<Home />);
      expect(
        screen.getByText(
          /newton solves problems with real tools — symbolic math, chemistry, statistics, your own code — instead of an llm guessing\. it remembers your whole semester\./i
        )
      ).toBeInTheDocument();
    });
  });
});
