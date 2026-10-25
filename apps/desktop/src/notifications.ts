import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/** Native OS notifications only fire while this app process is actually running —
 * there's no background service. The check itself is periodic (see
 * lib/studyReminders.ts) so a window hidden in the tray still nudges; fully-quit
 * reminders would need a backend job, which is out of scope. */
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
    sendNotification({
      title: "Newton",
      body: parts.join(" · "),
      extra: { kind: "study-reminder" },
    });
  } catch {
    // Non-fatal — a missed nudge shouldn't disrupt anything else in the app.
  }
}

/** Desktop support for notification clicks is spotty; callers also keep a
 * focus-based fallback. `extra.kind` distinguishes this from the tray-hide hint. */
export async function listenStudyReminderActions(onOpen: () => void): Promise<() => void> {
  try {
    const { onAction } = await import("@tauri-apps/plugin-notification");
    const listener = await onAction((notification) => {
      if (notification.extra?.kind === "study-reminder") onOpen();
    });
    return () => {
      void listener.unregister();
    };
  } catch {
    return () => {};
  }
}

/** One-time explanation after the first close-to-tray so a student doesn't think
 * Quit happened. Callers persist the "already shown" flag themselves (see
 * getTrayHideHintShown) so a failed send still counts as shown and doesn't loop. */
export async function notifyTrayHideHint(): Promise<void> {
  if (!(await ensurePermission())) return;
  try {
    sendNotification({
      title: "Newton",
      body: "Still running in the tray. Open Newton from the icon, or choose Quit to exit.",
    });
  } catch {
    // Non-fatal — same as notifyStudyReminders.
  }
}
