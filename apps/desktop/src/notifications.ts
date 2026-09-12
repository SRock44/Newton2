import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/** Native OS notifications only fire while this app process is actually running —
 * there's no background service, so this is a "nudge you while you have Newton open"
 * feature (checked once per sign-in, not a repeating poll that would just nag), not a
 * "reminds you even when the app is closed" one. That needs the system tray +
 * autostart, a separate roadmap item. */
async function ensurePermission(): Promise<boolean> {
  try {
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
    sendNotification({ title: "Newton", body: parts.join(" · ") });
  } catch {
    // Non-fatal — a missed nudge shouldn't disrupt anything else in the app.
  }
}
