/** The real, signed-in web app's own origin (apps/web) — where this marketing site's
 * "Sign In"/"Sign Up" actually send a student; this site has no auth code of its own
 * (see apps/web/README.md for why that's deliberate). Defaults to apps/web's local dev
 * server (apps/web/vite.config.ts pins it to this exact port specifically so this default
 * needs no configuration) — set NEXT_PUBLIC_APP_URL in production to the real deployed
 * origin (https://app.newton.best once that's live — see WEBSITE-ROADMAP.md's
 * deployment/cutover section, not done yet). */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5173";

/** A real link straight into apps/web's own Keycloak sign-in/register flow — apps/web's
 * LoginScreen reads this exact `?auth=` param on load and starts the right flow
 * immediately, no extra click once the student's already clicked Sign In/Sign Up here. */
export function appAuthUrl(mode: "login" | "register"): string {
  return `${APP_URL}/?auth=${mode}`;
}
