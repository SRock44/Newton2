import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager } from "../auth";
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
