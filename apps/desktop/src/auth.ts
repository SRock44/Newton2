import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
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
const REDIRECT_URI = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`;

// Refresh this long before actual expiry so a slow network call never loses the race
// against the token dying mid-request.
const EXPIRY_BUFFER_MS = 30_000;

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

async function exchangeCodeForTokens(code: string, verifier: string): Promise<TokenSet> {
  const res = await fetch(`${KEYCLOAK_URL}/realms/newton/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "newton-api",
      code,
      redirect_uri: REDIRECT_URI,
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

/** Opens the system browser to Keycloak's own hosted login page — which, now that
 * Google is registered as an Identity Provider on this realm, offers "Sign in with
 * Google" alongside the standard username/password fields, without this app needing
 * its own custom login form for either. Resolves once the browser redirects back to
 * the loopback listener with an authorization code, and exchanges it for tokens. */
export async function signInWithBrowser(): Promise<TokenSet> {
  const verifier = randomString(48);
  const challenge = await pkceChallenge(verifier);
  const state = randomString(16);

  const authUrl = new URL(`${KEYCLOAK_URL}/realms/newton/protocol/openid-connect/auth`);
  authUrl.searchParams.set("client_id", "newton-api");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", "openid");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  // Fire the listener first (invoke() starts the Rust command immediately — it does
  // not wait for this promise to be awaited) so the port is already bound well before
  // any human could plausibly finish a login and get redirected back.
  const waitForCallback = invoke<OAuthCallbackResult>("wait_for_oauth_callback", {
    port: OAUTH_CALLBACK_PORT,
  });

  await openUrl(authUrl.toString());

  const result = await waitForCallback;
  if (result.error) throw new ApiError(`Sign-in failed: ${result.error}`);
  if (!result.code) throw new ApiError("Sign-in didn't complete — no code received.");
  if (result.state !== state) {
    throw new ApiError("Sign-in failed a security check (state mismatch). Please try again.");
  }

  return exchangeCodeForTokens(result.code, verifier);
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

  constructor(onChange: (accessToken: string | null) => void) {
    this.onChange = onChange;
  }

  setTokens(tokens: TokenSet): void {
    this.tokens = tokens;
    this.onChange(tokens.accessToken);
  }

  clear(): void {
    this.tokens = null;
    this.refreshing = null;
    this.onChange(null);
  }

  hasSession(): boolean {
    return this.tokens !== null;
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
