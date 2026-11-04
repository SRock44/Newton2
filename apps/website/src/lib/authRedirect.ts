/**
 * Sends the browser straight to Keycloak's hosted sign-in/register form — no stop at
 * apps/web (`/chat`) first. Real, measured bug this fixes: clicking "Chat Now"/"Sign
 * In"/"Sign Up" used to link to `${APP_URL}?auth=${mode}` (see env.ts's appAuthUrl),
 * which loads the entire apps/web bundle, mounts it, and only THEN (LoginScreen.tsx's
 * own effect reading `?auth=`) redirects again to Keycloak — a real ~650ms stop at a
 * page the visitor never actually sees used for anything, confirmed by timing the real
 * navigation sequence in a live browser before writing this fix. Product owner,
 * verbatim: "can we just make that ONE redirect."
 *
 * This does NOT make apps/website an auth client in the sense env.ts's own comment
 * warns against (no token exchange, no session storage, no knowledge of a signed-in
 * state ever lives here) — it only knows how to kick off the exact same Authorization
 * Code + PKCE request apps/desktop/src/auth.ts's beginWebSignIn already builds, using
 * the SAME sessionStorage keys that file's completeWebSignIn already reads. Once
 * Keycloak redirects back to `/chat?code=...&state=...`, apps/web picks up from there
 * exactly as it does today — completeWebSignIn is entirely unchanged. Deliberately
 * duplicated (not imported from apps/desktop/src/auth.ts) rather than shared: that
 * file imports from apps/desktop/src/api.ts, which reads `import.meta.env.VITE_*`
 * (Vite-only syntax that doesn't exist under Next.js's bundler) — pulling it in would
 * mean patching a file three other things depend on just to reach a ~20-line function.
 */

const WEB_PKCE_VERIFIER_KEY = "newton:auth:pkce_verifier";
const WEB_PKCE_STATE_KEY = "newton:auth:pkce_state";

const KEYCLOAK_URL = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://127.0.0.1:58180";

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

function authEndpointPath(mode: "login" | "register"): string {
  return mode === "register"
    ? "/realms/newton/protocol/openid-connect/registrations"
    : "/realms/newton/protocol/openid-connect/auth";
}

/** Navigates the whole page to Keycloak — never resolves in the normal case (the
 * navigation itself is the point), same shape as beginWebSignIn in apps/desktop/src/
 * auth.ts. Call from an onClick handler, not a plain <a href>: this has to run
 * synchronously-ish client-side JS (PKCE challenge + sessionStorage) before the
 * redirect, which a plain link obviously can't do — see FloatingNav.tsx/page.tsx for
 * the progressive-enhancement pattern (keep the real appAuthUrl href as a fallback for
 * the rare case this throws or runs with JS disabled, middle-click/open-in-new-tab
 * still uses that same fallback since it bypasses onClick entirely). */
export async function redirectToSignIn(mode: "login" | "register" = "login"): Promise<void> {
  const verifier = randomString(48);
  const challenge = await pkceChallenge(verifier);
  const state = randomString(16);

  window.sessionStorage.setItem(WEB_PKCE_VERIFIER_KEY, verifier);
  window.sessionStorage.setItem(WEB_PKCE_STATE_KEY, state);

  const redirectUri = `${window.location.origin}/chat`;
  const authUrl = new URL(`${KEYCLOAK_URL}${authEndpointPath(mode)}`);
  authUrl.searchParams.set("client_id", "newton-api");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid offline_access");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  window.location.href = authUrl.toString();
}
