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
