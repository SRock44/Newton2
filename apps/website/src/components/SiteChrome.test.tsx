import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { SiteHeader, SiteFooter } from "./SiteChrome";

const redirectToSignIn = vi.fn();
vi.mock("@/lib/authRedirect", () => ({
  redirectToSignIn: (mode: "login" | "register") => redirectToSignIn(mode),
}));

describe("SiteHeader", () => {
  beforeEach(() => {
    redirectToSignIn.mockClear();
  });

  it("renders the primary nav with real internal routes for FAQ and Pro", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(within(nav).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faq");
    expect(within(nav).getByRole("link", { name: "Pro" })).toHaveAttribute("href", "/#pro");
    expect(within(nav).getByRole("link", { name: "Features" })).toHaveAttribute(
      "href",
      "/#features"
    );
  });

  it("wordmark links back to the homepage", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Newton" })).toHaveAttribute("href", "/");
  });

  it("Sign In/Sign Up link straight into apps/web's own real auth flow", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute(
      "href",
      "http://localhost:3000/chat?auth=login"
    );
    expect(screen.getByRole("link", { name: "Sign Up" })).toHaveAttribute(
      "href",
      "http://localhost:3000/chat?auth=register"
    );
  });

  it("Sign In/Sign Up redirect straight to Keycloak on click, skipping the /chat stop", () => {
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("link", { name: "Sign In" }));
    expect(redirectToSignIn).toHaveBeenCalledWith("login");

    fireEvent.click(screen.getByRole("link", { name: "Sign Up" }));
    expect(redirectToSignIn).toHaveBeenCalledWith("register");
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

  it("Download leads to the real download page now (Phase 4 is built)", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Download" })).toHaveAttribute("href", "/download");
  });

  it("doesn't repeat Sign In/Sign Up — they already live in the header", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).queryByRole("link", { name: "Sign In" })).not.toBeInTheDocument();
    expect(within(footer).queryByRole("link", { name: "Sign Up" })).not.toBeInTheDocument();
  });
});
