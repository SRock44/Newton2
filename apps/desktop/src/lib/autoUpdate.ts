import { isTauri } from "./platform";

/** Checks for a newer published release and installs it automatically, relaunching into
 * it -- fired once from main.tsx, at startup, BEFORE anything about sign-in state is
 * known. That's deliberate, not an oversight: this is exactly the safety net for a
 * student stuck on a broken build who can never reach a signed-in screen at all (the
 * real incident this exists for -- desktop-v0.2.0 shipped with Sign In pointed at a dev
 * SSH tunnel, see the v0.2.1 hotfix). Gating this behind login, or behind any app state
 * that itself might be the thing that's broken, would make it useless for the one case
 * it has to cover. No UI prompt: this runs before the student has done anything in the
 * app yet (right at launch), so a silent background check-and-relaunch is the lowest-
 * disruption option, not a shortcut -- same reasoning plenty of desktop apps (browsers,
 * Slack, VS Code) already apply to their own startup update checks.
 *
 * isTauri() guards this so apps/web (which loads this exact same src/ tree in a plain
 * browser tab, no Tauri bridge) never even imports `@tauri-apps/plugin-updater`'s real
 * code path -- that package's calls would just throw there, and the website has no
 * update to check for anyway, it's redeployed directly.
 *
 * Every failure mode here (no internet yet, GitHub unreachable, user offline, the
 * endpoint 404ing) is swallowed silently -- this must never be the reason the app fails
 * to start. Worst case: no update happens this launch, exactly like today before this
 * existed.
 */
export async function checkForUpdateAndInstall(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return;

    await update.downloadAndInstall();

    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    // Silent on purpose -- see the module docstring above.
  }
}
