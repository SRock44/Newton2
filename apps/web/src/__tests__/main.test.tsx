import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

/** A genuine integration smoke test, not a unit test: proves the whole cross-package
 * setup (vitest.config.ts's react/react-dom alias, apps/desktop/src/bootstrap.tsx's own
 * imports resolving via apps/desktop/node_modules, the real App/LoginScreen/auth/api
 * modules) actually works end to end under apps/web's OWN vitest instance — not just
 * under apps/desktop's, and not just under Vite's dev/build bundler (which resolves
 * modules differently than vitest's test runner does, so this is a real, independent
 * check, not a redundant one). */
describe("apps/web entry point", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("mounts the real Newton app via the shared apps/desktop bootstrap, and shows the login screen when signed out", async () => {
    await import("../main");
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    // Proves this really is the SAME LoginScreen apps/desktop uses, not a stand-in —
    // the exact copy text is apps/desktop/src/components/LoginScreen.tsx's own.
    expect(screen.getByText(/Opens your browser to sign in with Google/i)).toBeInTheDocument();
  });
});
