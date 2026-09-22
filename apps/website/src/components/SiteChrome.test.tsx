import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SiteHeader, SiteFooter } from "./SiteChrome";

describe("SiteHeader", () => {
  it("renders the primary nav with real internal routes for FAQ and Pro", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(within(nav).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faq");
    expect(within(nav).getByRole("link", { name: "Pro" })).toHaveAttribute("href", "/#pro");
    expect(within(nav).getByRole("link", { name: "Features" })).toHaveAttribute(
      "href",
      "/#verified"
    );
  });

  it("wordmark links back to the homepage", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Newton" })).toHaveAttribute("href", "/");
  });
});

describe("SiteFooter", () => {
  it("links About/FAQ/Changelog to real routes, never '#' stubs", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(within(footer).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faq");
    expect(within(footer).getByRole("link", { name: "Changelog" })).toHaveAttribute(
      "href",
      "/changelog"
    );
  });

  it("keeps genuinely unbuilt destinations (sign in/up, download, contact) honestly stubbed", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Sign In" })).toHaveAttribute("href", "#");
    expect(within(footer).getByRole("link", { name: "Download" })).toHaveAttribute("href", "#");
  });
});
