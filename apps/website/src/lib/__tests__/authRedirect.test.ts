import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { redirectToSignIn } from "../authRedirect";

/** A plain object stands in for `window.location` — same pattern apps/desktop/src/
 * __tests__/auth.test.ts already uses for beginWebSignIn (this file's own real,
 * non-duplicated counterpart): jsdom doesn't implement real navigation, and assigning
 * `.href` on the real one logs a noisy "not implemented" error even though the
 * assignment itself still "works." */
describe("redirectToSignIn (apps/website's direct-to-Keycloak redirect)", () => {
  const realLocation = window.location;

  function stubLocation(origin: string) {
    const loc = { origin, href: `${origin}/` };
    Object.defineProperty(window, "location", { value: loc, writable: true, configurable: true });
    return loc;
  }

  beforeEach(() => {
    window.sessionStorage.clear();
    stubLocation("http://localhost:3000");
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { value: realLocation, writable: true, configurable: true });
  });

  it("stashes a real PKCE verifier/state and redirects straight to Keycloak's hosted login — never /chat first", async () => {
    await redirectToSignIn("login");

    const verifier = window.sessionStorage.getItem("newton:auth:pkce_verifier");
    const state = window.sessionStorage.getItem("newton:auth:pkce_state");
    expect(verifier).toBeTruthy();
    expect(state).toBeTruthy();

    const url = new URL(window.location.href);
    expect(url.origin).not.toBe("http://localhost:3000"); // genuinely left the site, not /chat
    expect(url.pathname).toBe("/realms/newton/protocol/openid-connect/auth");
    expect(url.searchParams.get("client_id")).toBe("newton-api");
    expect(url.searchParams.get("response_type")).toBe("code");
    // Same redirect_uri apps/desktop/src/auth.ts's completeWebSignIn expects — this is
    // the whole point: that file is entirely unchanged by this one existing.
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/chat");
    expect(url.searchParams.get("scope")).toBe("openid offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(state);
  });

  it("with mode='register', redirects to Keycloak's registration form instead — same params otherwise", async () => {
    await redirectToSignIn("register");

    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/realms/newton/protocol/openid-connect/registrations");
    expect(url.searchParams.get("client_id")).toBe("newton-api");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/chat");
  });

  it("writes the EXACT sessionStorage keys apps/desktop/src/auth.ts's completeWebSignIn reads, so the handoff across two separate apps on the same origin actually works", async () => {
    await redirectToSignIn("login");

    // Hardcoded key names deliberately, not imported constants — this is the contract
    // between two separately-deployed apps that happen to share an origin, not two
    // modules in the same build; a silent rename on either side must break a test, not
    // just "still compile."
    expect(window.sessionStorage.getItem("newton:auth:pkce_verifier")).toBeTruthy();
    expect(window.sessionStorage.getItem("newton:auth:pkce_state")).toBeTruthy();
  });

  it("generates a fresh verifier/state on every call, never reusing a previous request's", async () => {
    await redirectToSignIn("login");
    const firstVerifier = window.sessionStorage.getItem("newton:auth:pkce_verifier");
    const firstState = window.sessionStorage.getItem("newton:auth:pkce_state");

    await redirectToSignIn("login");
    const secondVerifier = window.sessionStorage.getItem("newton:auth:pkce_verifier");
    const secondState = window.sessionStorage.getItem("newton:auth:pkce_state");

    expect(secondVerifier).not.toBe(firstVerifier);
    expect(secondState).not.toBe(firstState);
  });
});
