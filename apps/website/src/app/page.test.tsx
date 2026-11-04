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

    it("Sign In/Sign Up link straight into apps/web's own real auth flow, not a stub", () => {
      render(<Home />);
      const signIns = screen.getAllByRole("link", { name: "Sign In" });
      const signUps = screen.getAllByRole("link", { name: "Sign Up" });
      expect(signIns.length).toBeGreaterThan(0);
      expect(signUps.length).toBeGreaterThan(0);
      // ?auth= is what LoginScreen.tsx (apps/desktop/src/components/LoginScreen.tsx,
      // reused by apps/web) reads on load to start the right flow immediately.
      signIns.forEach((link) => expect(link).toHaveAttribute("href", "http://localhost:5173/?auth=login"));
      signUps.forEach((link) => expect(link).toHaveAttribute("href", "http://localhost:5173/?auth=register"));
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

    it("renders a visible primary 'Chat Now' CTA — chatting needs no download anymore", () => {
      render(<Home />);
      const chatLinks = screen.getAllByRole("link", { name: "Chat Now" });
      expect(chatLinks.length).toBeGreaterThan(0);
      // Same real apps/web sign-in link the header's Sign In uses — see env.ts's
      // appAuthUrl. Chat Now doesn't presume the visitor is new, so it's "login" mode
      // (Keycloak's hosted page covers both a new and returning student from there).
      chatLinks.forEach((link) => expect(link).toHaveAttribute("href", "http://localhost:5173/?auth=login"));
    });

    it("Download is a real, secondary CTA — not the primary ask anymore now that chatting needs no download", () => {
      render(<Home />);
      const downloadLinks = screen.getAllByRole("link", { name: "Download" });
      expect(downloadLinks.length).toBeGreaterThan(0);
      downloadLinks.forEach((link) => expect(link).toHaveAttribute("href", "/download"));
    });

    it("mentions the free-to-start note, and that no download is required to chat", () => {
      render(<Home />);
      expect(screen.getByText(/free to start/i)).toBeInTheDocument();
      expect(screen.getByText(/no download required/i)).toBeInTheDocument();
    });

    it("pounds heavy on the Agentic Learning Environment positioning with a real badge above the eyebrow", () => {
      render(<Home />);
      const badge = screen.getByText("The first Agentic Learning Environment");
      const eyebrow = screen.getByText("Verified, not vibes");
      expect(badge).toBeInTheDocument();
      // The hero badge sits above the "Verified, not vibes" eyebrow, not replacing it.
      // eslint-disable-next-line no-bitwise
      expect(badge.compareDocumentPosition(eyebrow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("renders the real, interactive demo widget directly under the hero copy, not a video or a screenshot", () => {
      render(<Home />);
      const tabs = screen.getAllByRole("tab");
      expect(tabs.length).toBe(3);
      expect(screen.getByRole("tab", { name: "Real computation" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
    });
  });

  describe("Phase 3.25: no screenshots, no video — every competitor at this level (checked claude.com directly) carries near-zero product imagery on its own marketing page", () => {
    it("renders zero <video> elements anywhere on the page", () => {
      render(<Home />);
      expect(document.querySelectorAll("video")).toHaveLength(0);
    });

    it("renders zero <img> elements anywhere on the page — the interactive demo is real markup, not a picture of the app", () => {
      render(<Home />);
      expect(document.querySelectorAll("img")).toHaveLength(0);
    });

    it("no longer renders the deleted MomentsShowcase screenshot grid", () => {
      render(<Home />);
      expect(screen.queryByText(/this is the app, not a pitch/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/real computation, not a guess/i)).not.toBeInTheDocument();
    });

    it("no longer renders the decorative corner-arrow nudge toward the secondary CTA", () => {
      render(<Home />);
      expect(document.querySelector("svg path[d^='M2 3 C 16 4']")).toBeNull();
    });
  });

  describe("capability cards (Phase 3.24: an icon-card grid, same real claims as the plain list it replaced)", () => {
    it("renders six real capability cards, each with an icon, a title, and the same grounded claim as before", () => {
      render(<Home />);
      expect(screen.getByRole("heading", { name: /what it does/i })).toBeInTheDocument();
      expect(screen.getByText("Exact computation")).toBeInTheDocument();
      expect(
        screen.getByText(/symbolic math, linear algebra, chemistry, and statistics/i)
      ).toBeInTheDocument();
      expect(screen.getByText("Spaced repetition")).toBeInTheDocument();
      expect(
        screen.getByText(/fsrs-scheduled flashcards, practice exams, and a weak-areas engine/i)
      ).toBeInTheDocument();
    });

    it("describes server-enforced Focus Mode, not just a prompt asking nicely", () => {
      render(<Home />);
      expect(screen.getByText("Focus Mode")).toBeInTheDocument();
      expect(screen.getByText(/holds back the answer until you ask/i)).toBeInTheDocument();
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
