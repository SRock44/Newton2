const STUDY_REMINDERS_KEY = "newton:prefs:studyReminders";

/** Whether to nag the student (a native OS notification, once per sign-in — see
 * notifications.ts and App.tsx) about flashcards or study plan items due soon.
 * Defaults on; persisted locally only, there's no backend concept of this yet. */
export function getStudyRemindersEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(STUDY_REMINDERS_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function setStudyRemindersEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STUDY_REMINDERS_KEY, String(enabled));
  } catch {
    // Best-effort only — worst case the preference doesn't stick across launches.
  }
}

const SIDEBAR_COLLAPSED_KEY = "newton:prefs:sidebarCollapsed";

/** Whether Sidebar.tsx is collapsed to its slim icon-only rail. Same "local preference,
 * not account data" pattern as getStudyRemindersEnabled above — this is window chrome,
 * not per-student data, so it's deliberately not keyed by user id (unlike
 * lib/homeWidgets.ts's per-account widget visibility). Defaults to expanded. */
export function getSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Best-effort only — worst case the preference doesn't stick across launches.
  }
}
