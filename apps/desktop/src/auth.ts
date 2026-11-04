import { ApiError, KEYCLOAK_URL } from "./api";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
}

// Fixed loopback port the desktop app listens on (via a tiny Rust-side HTTP listener,
// see src-tauri/src/lib.rs::wait_for_oauth_callback) for exactly one OAuth redirect —
// the same "installed app" pattern gcloud/gh CLIs use, chosen specifically to avoid
// registering a custom OS URL scheme (deep-linking), which is real Windows-dev-mode
// friction this sidesteps entirely. Must match a redirect URI registered on the
// "newton-api" Keycloak client.
const OAUTH_CALLBACK_PORT = 58500;
const DESKTOP_REDIRECT_URI = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`;

// apps/web's equivalent of the above: there's no loopback listener in a browser, so the
// redirect URI is just this same page, at a dedicated route that reads `?code&state` off
// the URL once Keycloak redirects back to it (see beginWebSignIn/completeWebSignIn below).
// Must ALSO be registered as a redirect URI on the "newton-api" Keycloak client, same as
// the desktop one above — see infra/keycloak/realm-newton.json.
function webRedirectUri(): string {
  return `${window.location.origin}/callback`;
}

// Refresh this long before actual expiry so a slow network call never loses the race
// against the token dying mid-request.
const EXPIRY_BUFFER_MS = 30_000;

// Persisted so a student doesn't have to sign in every time they open the app. Only the
// refresh token actually matters for that (the access token is short-lived and gets
// replaced within seconds of restoring a session anyway) — storing the whole set is
// just convenient. Requires the `offline_access` scope below: a *plain* refresh token
// is tied to the SSO session (Keycloak's default idle timeout is short, ~30 min), so it
// would already be dead by the time someone reopens the app later — an offline token is
// what's actually designed to keep working across real gaps between sessions.
const TOKENS_STORAGE_KEY = "newton:auth:tokens";

function loadStoredTokens(): TokenSet | null {
  try {
    const raw = window.localStorage.getItem(TOKENS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.accessToken === "string" &&
      typeof parsed?.refreshToken === "string" &&
      typeof parsed?.expiresAt === "number"
    ) {
      return parsed as TokenSet;
    }
  } catch {
    // Corrupt or unavailable storage — treat it the same as no stored session.
  }
  return null;
}

function storeTokens(tokens: TokenSet | null): void {
  try {
    if (tokens) window.localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(tokens));
    else window.localStorage.removeItem(TOKENS_STORAGE_KEY);
  } catch {
    // Best-effort only — worst case, the user just has to sign in again next launch.
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteLength = 48): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

async function tokensFromResponse(res: Response): Promise<TokenSet> {
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function exchangeCodeForTokens(code: string, verifier: string, redirectUri: string): Promise<TokenSet> {
  const res = await fetch(`${KEYCLOAK_URL}/realms/newton/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "newton-api",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new ApiError("Couldn't complete sign-in. Please try again.");
  return tokensFromResponse(res);
}

async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const res = await fetch(`${KEYCLOAK_URL}/realms/newton/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "newton-api",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new ApiError("Your session expired. Please sign in again.");
  return tokensFromResponse(res);
}

interface OAuthCallbackResult {
  code?: string;
  state?: string;
  error?: string;
}

/** Shared by both the desktop and web sign-in flows below — everything about the
 * authorization request is identical between them; only how the browser gets opened and
 * how the redirect comes back differs. */
function buildAuthUrl(redirectUri: string, challenge: string, state: string): string {
  const authUrl = new URL(`${KEYCLOAK_URL}/realms/newton/protocol/openid-connect/auth`);
  authUrl.searchParams.set("client_id", "newton-api");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  // offline_access is what makes "stay signed in" actually work — see the comment on
  // TOKENS_STORAGE_KEY above.
  authUrl.searchParams.set("scope", "openid offline_access");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  return authUrl.toString();
}

/** Opens the system browser to Keycloak's own hosted login page — which, now that
 * Google is registered as an Identity Provider on this realm, offers "Sign in with
 * Google" alongside the standard username/password fields, without this app needing
 * its own custom login form for either. Resolves once the browser redirects back to
 * the loopback listener with an authorization code, and exchanges it for tokens.
 *
 * Desktop (Tauri) only — apps/web uses beginWebSignIn/completeWebSignIn instead, since
 * there's no loopback listener to bind in a browser. */
export async function signInWithBrowser(): Promise<TokenSet> {
  const verifier = randomString(48);
  const challenge = await pkceChallenge(verifier);
  const state = randomString(16);
  const authUrl = buildAuthUrl(DESKTOP_REDIRECT_URI, challenge, state);

  const { invoke } = await import("@tauri-apps/api/core");
  const { openUrl } = await import("@tauri-apps/plugin-opener");

  // Fire the listener first (invoke() starts the Rust command immediately — it does
  // not wait for this promise to be awaited) so the port is already bound well before
  // any human could plausibly finish a login and get redirected back.
  const waitForCallback = invoke<OAuthCallbackResult>("wait_for_oauth_callback", {
    port: OAUTH_CALLBACK_PORT,
  });

  await openUrl(authUrl);

  const result = await waitForCallback;
  if (result.error) throw new ApiError(`Sign-in failed: ${result.error}`);
  if (!result.code) throw new ApiError("Sign-in didn't complete — no code received.");
  if (result.state !== state) {
    throw new ApiError("Sign-in failed a security check (state mismatch). Please try again.");
  }

  return exchangeCodeForTokens(result.code, verifier, DESKTOP_REDIRECT_URI);
}

// sessionStorage (not localStorage — this only needs to survive one redirect round trip,
// not a real session; see TOKENS_STORAGE_KEY above for where the actual signed-in session
// lives) keys for the PKCE verifier/state across the full-page navigation to Keycloak and
// back, since nothing in JS memory survives that navigation the way it does for the
// desktop flow's single in-process await.
const WEB_PKCE_VERIFIER_KEY = "newton:auth:pkce_verifier";
const WEB_PKCE_STATE_KEY = "newton:auth:pkce_state";

/** apps/web's equivalent of signInWithBrowser: navigates the WHOLE page to Keycloak's
 * hosted login (there's no second "system browser" to open — the page itself is the
 * browser), stashing the PKCE verifier/state first so completeWebSignIn can pick them
 * back up after Keycloak redirects back to webRedirectUri(). Never resolves in the normal
 * case — the navigation itself is the point — so callers should not `await` expecting
 * code to run after it; it's async only because pkceChallenge is. */
export async function beginWebSignIn(): Promise<void> {
  const verifier = randomString(48);
  const challenge = await pkceChallenge(verifier);
  const state = randomString(16);

  window.sessionStorage.setItem(WEB_PKCE_VERIFIER_KEY, verifier);
  window.sessionStorage.setItem(WEB_PKCE_STATE_KEY, state);

  window.location.href = buildAuthUrl(webRedirectUri(), challenge, state);
}

/** Call once, on load of the `/callback` route: reads `?code&state&error` off the current
 * URL, validates it against what beginWebSignIn stashed, and exchanges the code for
 * tokens. Returns null (not an error) when the page was loaded with no `code` at all —
 * i.e. this wasn't actually hit as an OAuth redirect — so a direct visit to `/callback`
 * degrades to "not signed in" rather than throwing. */
export async function completeWebSignIn(): Promise<TokenSet | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  const verifier = window.sessionStorage.getItem(WEB_PKCE_VERIFIER_KEY);
  const expectedState = window.sessionStorage.getItem(WEB_PKCE_STATE_KEY);
  window.sessionStorage.removeItem(WEB_PKCE_VERIFIER_KEY);
  window.sessionStorage.removeItem(WEB_PKCE_STATE_KEY);

  if (error) throw new ApiError(`Sign-in failed: ${error}`);
  if (!code) return null;
  if (!verifier || !expectedState) {
    throw new ApiError("Sign-in couldn't be completed — this browser tab lost track of the request. Please try again.");
  }
  if (state !== expectedState) {
    throw new ApiError("Sign-in failed a security check (state mismatch). Please try again.");
  }

  return exchangeCodeForTokens(code, verifier, webRedirectUri());
}

/** Decodes a JWT's payload for *display purposes only* (e.g. showing the user's name
 * in the sidebar) — this does not verify the signature and must never be used for any
 * authorization decision; the backend independently verifies every token it receives
 * against Keycloak's JWKS regardless of what the frontend does with it. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1] ?? "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

/** Holds the current token set and hands out access tokens that are guaranteed not to
 * be expired, refreshing first if needed. Concurrent callers near expiry share one
 * in-flight refresh rather than each firing their own. */
export class TokenManager {
  private tokens: TokenSet | null = null;
  private refreshing: Promise<string> | null = null;
  private onChange: (accessToken: string | null) => void;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onChange: (accessToken: string | null) => void) {
    this.onChange = onChange;
  }

  setTokens(tokens: TokenSet): void {
    this.tokens = tokens;
    storeTokens(tokens);
    this.onChange(tokens.accessToken);
    this._scheduleBackgroundRefresh();
  }

  clear(): void {
    this.tokens = null;
    this.refreshing = null;
    storeTokens(null);
    this.onChange(null);
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Keeps `this.tokens` (and every `onChange` subscriber — every plain REST call in
   * api.ts reads that React `token` state directly, not getValidAccessToken) fresh on
   * its own clock, instead of only ever refreshing reactively when something happens to
   * open a new WebSocket. Real bug this fixes: a student staying on the SAME chat
   * session for longer than the realm's accessTokenLifespan (infra/keycloak/
   * realm-newton.json, 3600s) with no new WS connection in between had a silently
   * stale token sitting in React state the whole time -- getValidAccessToken's own
   * proactive refresh never got a chance to run, since nothing was calling it. Every
   * ordinary REST call (a settings toggle like Learn Mode, a billing-status fetch, ...)
   * used that stale token, got a 401, and surfaced as a generic "couldn't save" error
   * with no indication it was ever a token problem. Self-perpetuating: each successful
   * background refresh calls setTokens again, which reschedules the next one. */
  private _scheduleBackgroundRefresh(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    if (!this.tokens) return;
    const delay = Math.max(0, this.tokens.expiresAt - EXPIRY_BUFFER_MS - Date.now());
    this.refreshTimer = setTimeout(() => {
      // Reuses getValidAccessToken's own de-duplication (shares an in-flight refresh
      // with any concurrent caller, e.g. a WS reconnect landing at the same moment)
      // rather than calling _refreshNow directly. A failure here means the refresh
      // token itself is no longer valid (revoked, or past the offline session's own
      // much-longer max lifespan) -- sign out cleanly to the login screen rather than
      // leaving a dead session silently failing every REST call forever.
      this.getValidAccessToken().catch(() => this.clear());
    }, delay);
  }

  hasSession(): boolean {
    return this.tokens !== null;
  }

  /** Call once, on app launch, before showing the login screen — tries to silently
   * resume a session from tokens persisted locally by a previous run (see
   * TOKENS_STORAGE_KEY). Returns true if a session was actually restored (onChange has
   * already fired, exactly as if setTokens had just been called), false if there was
   * nothing stored or it turned out to be stale (revoked, or past the offline session's
   * own — much longer — max lifespan): the caller should fall back to the login screen. */
  async tryRestoreSession(): Promise<boolean> {
    const stored = loadStoredTokens();
    if (!stored) return false;
    this.tokens = stored;
    try {
      // Always refresh immediately on launch rather than trusting the stored
      // expiresAt: the access token is virtually always already expired by the time
      // the app is reopened, and this doubles as the actual validity check for the
      // stored refresh token itself.
      await this._refreshNow();
      return true;
    } catch {
      this.clear();
      return false;
    }
  }

  /** Always returns a token valid for at least EXPIRY_BUFFER_MS — callers about to open
   * a new WebSocket (which is only auth-checked once, at connect time) should always
   * go through this rather than a cached string, since that's exactly the path that
   * broke before this existed: a chat left open stays open past expiry (no re-check on
   * an established connection), but opening a *new* one with a stale token fails outright. */
  async getValidAccessToken(): Promise<string> {
    if (!this.tokens) throw new ApiError("Not signed in.");
    if (Date.now() < this.tokens.expiresAt - EXPIRY_BUFFER_MS) {
      return this.tokens.accessToken;
    }
    if (!this.refreshing) {
      this.refreshing = this._refreshNow().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async _refreshNow(): Promise<string> {
    if (!this.tokens) throw new ApiError("Not signed in.");
    const fresh = await refreshTokens(this.tokens.refreshToken);
    this.setTokens(fresh);
    return fresh.accessToken;
  }
}
