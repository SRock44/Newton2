import type { Flashcard, StudyPlanItem } from "../types";

export const DUE_SOON_DAYS = 3;
export const REMINDER_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const REMINDER_CLICK_WINDOW_MS = 10 * 60 * 1000;

export type ReminderSummary = {
  dueFlashcards: number;
  dueSoonItems: number;
};

export type LastStudyReminder = ReminderSummary & {
  date: string;
};

export function localDateKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Counts due flashcards (already filtered by the API) and study-plan items whose
 * calendar due date is on or before `now + DUE_SOON_DAYS`. Items with no
 * `due_date` (or an unparseable one) are skipped, not guessed. */
export function buildReminderSummary(
  flashcards: Array<Pick<Flashcard, "id">>,
  studyPlan: Array<Pick<StudyPlanItem, "due_date">>,
  now: Date,
): ReminderSummary {
  const cutoff = now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
  let dueSoonItems = 0;
  for (const item of studyPlan) {
    if (!item.due_date) continue;
    const dueTime = new Date(item.due_date).getTime();
    if (!Number.isNaN(dueTime) && dueTime <= cutoff) dueSoonItems += 1;
  }
  return { dueFlashcards: flashcards.length, dueSoonItems };
}

/** A new toast only if something is actually due AND (we've never notified, it's a
 * new local day, or a count went up). Same-day equal/lower counts stay quiet so a
 * 3-hour poll doesn't nag after the student already saw the numbers. */
export function shouldNotifyReminder(
  current: ReminderSummary,
  last: LastStudyReminder | null,
  now: Date,
): boolean {
  if (current.dueFlashcards <= 0 && current.dueSoonItems <= 0) return false;
  if (!last) return true;
  if (last.date !== localDateKey(now)) return true;
  return current.dueFlashcards > last.dueFlashcards || current.dueSoonItems > last.dueSoonItems;
}

export function shouldOpenFlashcardsOnFocus(lastNotifiedAt: number | null, now: number): boolean {
  if (lastNotifiedAt == null) return false;
  return now - lastNotifiedAt <= REMINDER_CLICK_WINDOW_MS;
}

export type StudyReminderLoopDeps = {
  intervalMs?: number;
  now?: () => Date;
  isEnabled: () => boolean;
  listDue: () => Promise<{
    flashcards: Array<Pick<Flashcard, "id">>;
    studyPlan: Array<Pick<StudyPlanItem, "due_date">>;
  }>;
  notify: (summary: ReminderSummary) => Promise<void>;
  getLast: () => LastStudyReminder | null;
  setLast: (value: LastStudyReminder) => void;
  setTrayCount: (count: number) => void;
  onNotified?: (at: number) => void;
};

/** Immediate check, then the same check on an interval, while the process is
 * alive (including hidden in the tray). Returns a cancel function. */
export function startStudyReminderLoop(deps: StudyReminderLoopDeps): () => void {
  const intervalMs = deps.intervalMs ?? REMINDER_INTERVAL_MS;
  const nowFn = deps.now ?? (() => new Date());
  let cancelled = false;

  const run = async () => {
    try {
      const { flashcards, studyPlan } = await deps.listDue();
      if (cancelled) return;
      const now = nowFn();
      const summary = buildReminderSummary(flashcards, studyPlan, now);
      deps.setTrayCount(summary.dueFlashcards);
      if (!deps.isEnabled()) return;
      if (!shouldNotifyReminder(summary, deps.getLast(), now)) return;
      await deps.notify(summary);
      if (cancelled) return;
      deps.setLast({ ...summary, date: localDateKey(now) });
      deps.onNotified?.(now.getTime());
    } catch {
      // A missed reminder must never break sign-in or show an error banner.
    }
  };

  void run();
  const id = window.setInterval(() => {
    void run();
  }, intervalMs);
  return () => {
    cancelled = true;
    window.clearInterval(id);
  };
}
