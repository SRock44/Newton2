import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDueDate } from "../../lib/dueDate";
import { formatShortDate } from "../HomeView";

// A study-plan deadline is a plain calendar date. `new Date("2026-02-06")` is midnight UTC, which
// anywhere west of UTC is the previous evening -- so "Feb 6" used to show as "Feb 5" on Home.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Home due dates", () => {
  it.each(["America/New_York", "America/Los_Angeles", "Pacific/Honolulu", "UTC", "Asia/Tokyo"])(
    "shows a date-only deadline as that same day in %s",
    (tz) => {
      vi.stubEnv("TZ", tz);
      expect(formatShortDate("2026-02-06")).toBe("Feb 6");
      expect(parseDueDate("2026-02-06").getDate()).toBe(6);
      expect(parseDueDate("2026-02-06").getHours()).toBe(0);
    },
  );

  it("still parses a full timestamp as a real instant", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(parseDueDate("2026-02-06T15:00:00Z").toISOString()).toBe("2026-02-06T15:00:00.000Z");
  });

  it("returns an empty string for something that isn't a date", () => {
    expect(formatShortDate("not a date")).toBe("");
  });
});
