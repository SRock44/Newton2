import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CalendarPanel, { toLocalInputValue } from "../CalendarPanel";
import type { CalendarEvent, StudyPlanItem } from "../../types";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    listCalendarEvents: vi.fn(),
    createCalendarEvent: vi.fn(),
    updateCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
    listStudyPlan: vi.fn(),
  };
});

import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  listStudyPlan,
  updateCalendarEvent,
} from "../../api";

/** Built in LOCAL time on purpose: the panel groups and labels by the user's own day, so
 * a fixture pinned to a UTC instant would land on a different calendar day depending on
 * where the test runs. */
function localIso(daysFromToday: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "ev-1",
    title: "Chem lab",
    start_at: localIso(0, 14),
    end_at: localIso(0, 16),
    notes: null,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function planItem(overrides: Partial<StudyPlanItem> = {}): StudyPlanItem {
  return {
    id: "sp-1",
    document_id: "doc-1",
    title: "Problem Set 1",
    due_date: null,
    due_date_text: null,
    notes: null,
    source: "syllabus_upload",
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function todayDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("CalendarPanel", () => {
  beforeEach(() => {
    vi.mocked(listCalendarEvents).mockReset().mockResolvedValue([]);
    vi.mocked(listStudyPlan).mockReset().mockResolvedValue([]);
    vi.mocked(createCalendarEvent).mockReset();
    vi.mocked(updateCalendarEvent).mockReset();
    vi.mocked(deleteCalendarEvent).mockReset();
  });

  it("shows an empty state when there's nothing scheduled", async () => {
    render(<CalendarPanel token="tok" onClose={() => {}} />);
    expect(await screen.findByText(/nothing scheduled yet/i)).toBeInTheDocument();
  });

  it("groups events under a day heading and shows their time range", async () => {
    vi.mocked(listCalendarEvents).mockResolvedValue([event()]);
    render(<CalendarPanel token="tok" onClose={() => {}} />);

    expect(await screen.findByText("Chem lab")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    // A real range, not just a start time.
    expect(screen.getByText(/–/)).toBeInTheDocument();
  });

  it("shows only a start time for a point-in-time event with no end", async () => {
    vi.mocked(listCalendarEvents).mockResolvedValue([
      event({ id: "ev-2", title: "Dentist", start_at: localIso(1, 9), end_at: null }),
    ]);
    render(<CalendarPanel token="tok" onClose={() => {}} />);

    expect(await screen.findByText("Dentist")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tomorrow" })).toBeInTheDocument();
    expect(screen.queryByText(/–/)).not.toBeInTheDocument();
  });

  it("folds dated study plan items into the agenda read-only, and skips undated ones", async () => {
    vi.mocked(listStudyPlan).mockResolvedValue([
      planItem({ due_date: todayDateString(), notes: "10% of grade" }),
      planItem({ id: "sp-2", title: "Reading Response", due_date: null, due_date_text: "Week 3" }),
    ]);
    render(<CalendarPanel token="tok" onClose={() => {}} />);

    expect(await screen.findByText("Problem Set 1")).toBeInTheDocument();
    expect(screen.getByText("Due · from your study plan")).toBeInTheDocument();
    expect(screen.getByText("10% of grade")).toBeInTheDocument();
    // No date to place it on — it stays in the Study plan panel rather than being guessed.
    expect(screen.queryByText("Reading Response")).not.toBeInTheDocument();
    // Study plan items aren't editable here.
    expect(screen.queryByRole("button", { name: /edit problem set 1/i })).not.toBeInTheDocument();
  });

  it("creates a real event, sending an ISO instant the backend can store", async () => {
    const user = userEvent.setup();
    const created = event({ id: "ev-new", title: "Study group" });
    vi.mocked(createCalendarEvent).mockResolvedValue(created);
    render(<CalendarPanel token="tok" onClose={() => {}} />);
    await screen.findByText(/nothing scheduled yet/i);

    await user.click(screen.getByRole("button", { name: /new event/i }));
    await user.type(screen.getByLabelText(/title/i), "Study group");
    await user.click(screen.getByRole("button", { name: /add event/i }));

    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalledTimes(1));
    const [token, payload] = vi.mocked(createCalendarEvent).mock.calls[0];
    expect(token).toBe("tok");
    expect(payload.title).toBe("Study group");
    // A real instant, not a bare wall-clock string.
    expect(payload.start_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(payload.start_at).getTime()).not.toBeNaN();
    // Left blank -> explicitly null, which is what lets a later edit clear an end time.
    expect(payload.end_at).toBeNull();

    expect(await screen.findByText("Study group")).toBeInTheDocument();
  });

  it("edits an existing event and sends an explicit null to clear its end time", async () => {
    const user = userEvent.setup();
    vi.mocked(listCalendarEvents).mockResolvedValue([event()]);
    vi.mocked(updateCalendarEvent).mockResolvedValue(
      event({ title: "Chem lab (moved)", end_at: null }),
    );
    render(<CalendarPanel token="tok" onClose={() => {}} />);
    await screen.findByText("Chem lab");

    await user.click(screen.getByRole("button", { name: /edit chem lab/i }));
    const titleInput = screen.getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Chem lab (moved)");
    await user.clear(screen.getByLabelText(/ends/i));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateCalendarEvent).toHaveBeenCalledTimes(1));
    const [, eventId, changes] = vi.mocked(updateCalendarEvent).mock.calls[0];
    expect(eventId).toBe("ev-1");
    expect(changes.title).toBe("Chem lab (moved)");
    expect(changes.end_at).toBeNull();
    expect(await screen.findByText("Chem lab (moved)")).toBeInTheDocument();
  });

  it("deletes an event and drops it from the agenda", async () => {
    const user = userEvent.setup();
    vi.mocked(listCalendarEvents).mockResolvedValue([event()]);
    vi.mocked(deleteCalendarEvent).mockResolvedValue(undefined);
    render(<CalendarPanel token="tok" onClose={() => {}} />);
    await screen.findByText("Chem lab");

    await user.click(screen.getByRole("button", { name: /delete chem lab/i }));

    await waitFor(() => expect(deleteCalendarEvent).toHaveBeenCalledWith("tok", "ev-1"));
    expect(screen.queryByText("Chem lab")).not.toBeInTheDocument();
  });

  it("surfaces a load failure instead of pretending the calendar is empty", async () => {
    vi.mocked(listCalendarEvents).mockRejectedValue(new Error("network blip"));
    render(<CalendarPanel token="tok" onClose={() => {}} />);

    expect(await screen.findByText(/couldn't load your calendar/i)).toBeInTheDocument();
  });
});

describe("toLocalInputValue", () => {
  it("renders an instant in the user's own local time, not UTC", () => {
    const iso = localIso(0, 14, 30);
    const value = toLocalInputValue(iso);
    const local = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(value).toBe(
      `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T14:30`,
    );
  });

  it("returns an empty string for an unparseable value rather than 'Invalid Date'", () => {
    expect(toLocalInputValue("not a date")).toBe("");
  });
});
