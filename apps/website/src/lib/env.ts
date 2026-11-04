/** The real, signed-in app's own path — ONE origin for the whole product, not a separate
 * port/subdomain. Product owner, verbatim: "it should not be on TWO SEPARATE PORTS. IT
 * SHOULD BE LIKE NEWTON.BEST/CHAT." apps/web (the real app) is proxied/served at this
 * exact path by this site's own Next.js (see next.config.ts's rewrites, and
 * apps/web/vite.config.ts's matching `base: "/chat/"`) — this site has no auth code of
 * its own (see apps/web/README.md for why that's deliberate), it just links here.
 * Defaults to this site's own local dev origin; set NEXT_PUBLIC_APP_URL only if the real
 * deployment ever needs to override it (shouldn't, once this ships to newton.best/chat —
 * see WEBSITE-ROADMAP.md's deployment/cutover section, not done yet). */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000/chat";

/** A real link straight into apps/web's own Keycloak sign-in/register flow — apps/web's
 * LoginScreen reads this exact `?auth=` param on load and starts the right flow
 * immediately, no extra click once the student's already clicked Sign In/Sign Up here. */
export function appAuthUrl(mode: "login" | "register"): string {
  return `${APP_URL}?auth=${mode}`;
}
