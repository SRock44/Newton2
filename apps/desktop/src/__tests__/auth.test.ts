import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager, beginWebSignIn, completeWebSignIn } from "../auth";
import type { TokenSet } from "../auth";

/** Real bug this file guards against: a student staying on the same chat session
 * longer than the realm's accessTokenLifespan (3600s) with no new WebSocket opened in
 * between had a silently stale access token sitting in React state -- nothing was ever
 * calling TokenManager.getValidAccessToken() to refresh it, so every ordinary REST call
 * (a settings toggle, a billing-status fetch, ...) 401'd with a generic error. */

function fakeTokenResponse(expiresInSeconds: number) {
  return {
    ok: true,
    json: async () => ({
      access_token: `access-${Math.random()}`,
      refresh_token: `refresh-${Math.random()}`,
      expires_in: expiresInSeconds,
    }),
  } as Response;
}

function makeTokens(expiresInMs: number): TokenSet {
  return {
    accessToken: "initial-access",
    refreshToken: "initial-refresh",
    expiresAt: Date.now() + expiresInMs,
  };
}

describe("TokenManager background refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("proactively refreshes on its own schedule, with no WebSocket/getValidAccessToken call needed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeTokenResponse(3600));
    vi.stubGlobal("fetch", fetchMock);

    const onChange = vi.fn();
    const manager = new TokenManager(onChange);
    manager.setTokens(makeTokens(3600 * 1000));

    expect(fetchMock).not.toHaveBeenCalled();
    onChange.mockClear();

    // Just past the accessTokenLifespan minus the 30s refresh buffer.
    await vi.advanceTimersByTimeAsync(3600 * 1000 - 30_000 + 1000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("access-"));
  });

  it("keeps re-scheduling after each successful background refresh (self-perpetuating)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeTokenResponse(3600));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new TokenManager(vi.fn());
    manager.setTokens(makeTokens(3600 * 1000));

    await vi.advanceTimersByTimeAsync(3600 * 1000 - 30_000 + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second full cycle should trigger a second background refresh on its own.
    await vi.advanceTimersByTimeAsync(3600 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("signs out cleanly if the background refresh itself fails (e.g. a revoked refresh token)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const onChange = vi.fn();
    const manager = new TokenManager(onChange);
    manager.setTokens(makeTokens(3600 * 1000));
    onChange.mockClear();

    await vi.advanceTimersByTimeAsync(3600 * 1000 - 30_000 + 1000);

    expect(onChange).toHaveBeenCalledWith(null);
    expect(manager.hasSession()).toBe(false);
  });

  it("cancels the pending background refresh on sign-out, so no stray refresh fires after clear()", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeTokenResponse(3600));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new TokenManager(vi.fn());
    manager.setTokens(makeTokens(3600 * 1000));
    manager.clear();

    await vi.advanceTimersByTimeAsync(3600 * 1000 + 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** apps/web's redirect-based sign-in — the browser equivalent of signInWithBrowser's
 * loopback-listener flow above, used by apps/web, mounted at its one fixed `/chat` path. A plain object stands
 * in for `window.location` throughout (not the real jsdom Location): jsdom doesn't
 * implement real navigation, and assigning `.href`/`.search` on the real one logs a noisy
 * "not implemented" error even though the assignment itself still "works" — a stand-in
 * object sidesteps that entirely while still letting beginWebSignIn's `location.href =`
 * and completeWebSignIn's `location.search` reads behave exactly like the real thing. */
describe("beginWebSignIn / completeWebSignIn (apps/web's redirect-based OAuth flow)", () => {
  const realLocation = window.location;

  function stubLocation(origin: string) {
    const loc = { origin, href: `${origin}/`, search: "" };
    Object.defineProperty(window, "location", { value: loc, writable: true, configurable: true });
    return loc;
  }

  beforeEach(() => {
    window.sessionStorage.clear();
    stubLocation("https://app.newton.best");
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { value: realLocation, writable: true, configurable: true });
  });

  it("stashes the PKCE verifier/state and redirects to Keycloak's hosted login", async () => {
    await beginWebSignIn();

    const verifier = window.sessionStorage.getItem("newton:auth:pkce_verifier");
    const state = window.sessionStorage.getItem("newton:auth:pkce_state");
    expect(verifier).toBeTruthy();
    expect(state).toBeTruthy();

    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/realms/newton/protocol/openid-connect/auth");
    expect(url.searchParams.get("client_id")).toBe("newton-api");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.newton.best/chat");
    expect(url.searchParams.get("scope")).toBe("openid offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(state);
  });

  it("with mode='register', redirects to Keycloak's registration form instead of login — same params otherwise", async () => {
    await beginWebSignIn("register");

    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/realms/newton/protocol/openid-connect/registrations");
    expect(url.searchParams.get("client_id")).toBe("newton-api");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.newton.best/chat");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges the code for tokens using the verifier beginWebSignIn stashed, then clears it (one-time use)", async () => {
    await beginWebSignIn();
    const state = window.sessionStorage.getItem("newton:auth:pkce_state")!;
    const verifierBefore = window.sessionStorage.getItem("newton:auth:pkce_verifier")!;

    window.location.search = `?code=abc123&state=${state}`;
    const fetchMock = vi.fn().mockResolvedValue(fakeTokenResponse(3600));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await completeWebSignIn();

    expect(tokens?.accessToken).toMatch(/^access-/);
    const body = fetchMock.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get("code")).toBe("abc123");
    expect(body.get("code_verifier")).toBe(verifierBefore);
    expect(body.get("redirect_uri")).toBe("https://app.newton.best/chat");
    expect(window.sessionStorage.getItem("newton:auth:pkce_verifier")).toBeNull();
    expect(window.sessionStorage.getItem("newton:auth:pkce_state")).toBeNull();
  });

  it("returns null (not an error) when the page wasn't actually hit as an OAuth redirect", async () => {
    window.location.search = "";
    await expect(completeWebSignIn()).resolves.toBeNull();
  });

  it("rejects a state mismatch rather than accepting a forged/stale callback", async () => {
    await beginWebSignIn();
    window.location.search = "?code=abc123&state=not-the-real-state";
    await expect(completeWebSignIn()).rejects.toThrow(/security check/);
  });

  it("surfaces an explicit error param from Keycloak (e.g. the student cancelled)", async () => {
    window.location.search = "?error=access_denied";
    await expect(completeWebSignIn()).rejects.toThrow(/Sign-in failed/);
  });

  it("refuses to complete if this tab lost its stashed verifier (e.g. a different tab)", async () => {
    window.location.search = "?code=abc123&state=some-state";
    await expect(completeWebSignIn()).rejects.toThrow(/lost track/);
  });
});
