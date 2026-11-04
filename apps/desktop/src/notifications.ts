import { isTauri } from "./lib/platform";

/** Native OS notifications only fire while this app process is actually running —
 * there's no background service, so this is a "nudge you while you have Newton open"
 * feature (checked once per sign-in, not a repeating poll that would just nag), not a
 * "reminds you even when the app is closed" one. That needs the system tray +
 * autostart, a desktop-only capability with no web equivalent at all (see
 * `lib/platform.ts`'s `isTauri`).
 *
 * In a browser, the standard `Notification` API is near-identical in shape
 * (permission-gated, one-shot) — a real, if slightly weaker, equivalent: it can't nudge
 * once the tab is fully closed either, but does work across minimized/backgrounded
 * tabs, same as the desktop version works while minimized. */
async function ensurePermission(): Promise<boolean> {
  try {
    if (!isTauri()) {
      if (typeof Notification === "undefined") return false;
      if (Notification.permission === "denied") return false;
      if (Notification.permission === "granted") return true;
      return (await Notification.requestPermission()) === "granted";
    }
    const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    return granted;
  } catch {
    // Notification APIs can be unavailable in some environments (e.g. this file
    // imported under a test runner with no Tauri context) — never let that break login.
    return false;
  }
}

export async function notifyStudyReminders(dueFlashcards: number, dueSoonItems: number): Promise<void> {
  if (dueFlashcards <= 0 && dueSoonItems <= 0) return;
  if (!(await ensurePermission())) return;

  const parts: string[] = [];
  if (dueFlashcards > 0) {
    parts.push(`${dueFlashcards} flashcard${dueFlashcards === 1 ? "" : "s"} due for review`);
  }
  if (dueSoonItems > 0) {
    parts.push(`${dueSoonItems} assignment${dueSoonItems === 1 ? "" : "s"} due soon`);
  }

  try {
    if (isTauri()) {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification({ title: "Newton", body: parts.join(" · ") });
    } else if (typeof Notification !== "undefined") {
      new Notification("Newton", { body: parts.join(" · ") });
    }
  } catch {
    // Non-fatal — a missed nudge shouldn't disrupt anything else in the app.
  }
}
