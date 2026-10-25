import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  REMINDER_CLICK_WINDOW_MS,
  REMINDER_INTERVAL_MS,
  buildReminderSummary,
  localDateKey,
  shouldNotifyReminder,
  shouldOpenFlashcardsOnFocus,
  startStudyReminderLoop,
} from "../studyReminders";

const NOW = new Date("2026-10-24T16:00:00-04:00");

function isoDateOffset(days: number): string {
  const d = new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

describe("buildReminderSummary", () => {
  it("counts already-filtered flashcards and study-plan items due within 3 days", () => {
    const summary = buildReminderSummary(
      [{ id: "a" }, { id: "b" }],
      [
        { due_date: isoDateOffset(1) },
        { due_date: isoDateOffset(3) },
        { due_date: isoDateOffset(4) },
        { due_date: null },
        { due_date: "not-a-date" },
      ],
      NOW,
    );
    expect(summary).toEqual({ dueFlashcards: 2, dueSoonItems: 2 });
  });

  it("counts an item that is already overdue", () => {
    const summary = buildReminderSummary([], [{ due_date: isoDateOffset(-1) }], NOW);
    expect(summary.dueSoonItems).toBe(1);
  });

  it("returns zeros for empty inputs", () => {
    expect(buildReminderSummary([], [], NOW)).toEqual({ dueFlashcards: 0, dueSoonItems: 0 });
  });
});

describe("shouldNotifyReminder", () => {
  it("never notifies when nothing is due", () => {
    expect(shouldNotifyReminder({ dueFlashcards: 0, dueSoonItems: 0 }, null, NOW)).toBe(false);
  });

  it("notifies the first time something is due", () => {
    expect(shouldNotifyReminder({ dueFlashcards: 1, dueSoonItems: 0 }, null, NOW)).toBe(true);
  });

  it("notifies again on a new local day even if the counts are unchanged", () => {
    expect(
      shouldNotifyReminder(
        { dueFlashcards: 1, dueSoonItems: 1 },
        { date: "2026-10-23", dueFlashcards: 1, dueSoonItems: 1 },
        NOW,
      ),
    ).toBe(true);
  });

  it("stays quiet on the same day when counts did not go up", () => {
    const last = { date: localDateKey(NOW), dueFlashcards: 2, dueSoonItems: 1 };
    expect(shouldNotifyReminder({ dueFlashcards: 2, dueSoonItems: 1 }, last, NOW)).toBe(false);
    expect(shouldNotifyReminder({ dueFlashcards: 1, dueSoonItems: 1 }, last, NOW)).toBe(false);
  });

  it("notifies the same day if a count went up", () => {
    const last = { date: localDateKey(NOW), dueFlashcards: 1, dueSoonItems: 0 };
    expect(shouldNotifyReminder({ dueFlashcards: 2, dueSoonItems: 0 }, last, NOW)).toBe(true);
    expect(shouldNotifyReminder({ dueFlashcards: 1, dueSoonItems: 1 }, last, NOW)).toBe(true);
  });
});

describe("shouldOpenFlashcardsOnFocus", () => {
  it("opens only within the 10-minute click window", () => {
    expect(shouldOpenFlashcardsOnFocus(null, 1_000_000)).toBe(false);
    expect(shouldOpenFlashcardsOnFocus(1_000_000, 1_000_000 + REMINDER_CLICK_WINDOW_MS)).toBe(true);
    expect(shouldOpenFlashcardsOnFocus(1_000_000, 1_000_000 + REMINDER_CLICK_WINDOW_MS + 1)).toBe(false);
  });
});

describe("startStudyReminderLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies immediately, then again after the interval when counts rise", async () => {
    const listDue = vi
      .fn()
      .mockResolvedValueOnce({ flashcards: [{ id: "a" }], studyPlan: [] })
      .mockResolvedValueOnce({ flashcards: [{ id: "a" }, { id: "b" }], studyPlan: [] });
    const notify = vi.fn(async () => undefined);
    const setTrayCount = vi.fn();
    let stored: { date: string; dueFlashcards: number; dueSoonItems: number } | null = null;

    const stop = startStudyReminderLoop({
      intervalMs: REMINDER_INTERVAL_MS,
      now: () => NOW,
      isEnabled: () => true,
      listDue,
      notify,
      getLast: () => stored,
      setLast: (value) => {
        stored = value;
      },
      setTrayCount,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ dueFlashcards: 1, dueSoonItems: 0 });
    expect(setTrayCount).toHaveBeenCalledWith(1);

    await vi.advanceTimersByTimeAsync(REMINDER_INTERVAL_MS);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith({ dueFlashcards: 2, dueSoonItems: 0 });
    expect(setTrayCount).toHaveBeenLastCalledWith(2);

    stop();
  });

  it("does not re-notify the same counts on the same day", async () => {
    const listDue = vi.fn().mockResolvedValue({ flashcards: [{ id: "a" }], studyPlan: [] });
    const notify = vi.fn(async () => undefined);
    let stored: { date: string; dueFlashcards: number; dueSoonItems: number } | null = null;

    const stop = startStudyReminderLoop({
      intervalMs: REMINDER_INTERVAL_MS,
      now: () => NOW,
      isEnabled: () => true,
      listDue,
      notify,
      getLast: () => stored,
      setLast: (value) => {
        stored = value;
      },
      setTrayCount: () => {},
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REMINDER_INTERVAL_MS);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it("still updates the tray count when reminders are disabled", async () => {
    const notify = vi.fn(async () => undefined);
    const setTrayCount = vi.fn();
    const stop = startStudyReminderLoop({
      now: () => NOW,
      isEnabled: () => false,
      listDue: async () => ({ flashcards: [{ id: "a" }], studyPlan: [] }),
      notify,
      getLast: () => null,
      setLast: () => {},
      setTrayCount,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(setTrayCount).toHaveBeenCalledWith(1);
    expect(notify).not.toHaveBeenCalled();
    stop();
  });
});
