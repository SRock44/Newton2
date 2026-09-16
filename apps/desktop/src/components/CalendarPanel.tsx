import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  listStudyPlan,
  updateCalendarEvent,
} from "../api";
import type { CalendarEvent, StudyPlanItem } from "../types";

interface CalendarPanelProps {
  token: string;
  onClose: () => void;
}

/** One row in the agenda. Study plan items are folded in read-only so the calendar shows
 * everything a student actually has coming up, rather than being a second list they have
 * to remember to cross-reference against Study plan. Only `event` rows are editable here;
 * a deadline extracted from a syllabus is owned by the Study plan panel. */
type AgendaEntry =
  | { kind: "event"; id: string; sortKey: number; dayKey: string; event: CalendarEvent }
  | { kind: "plan"; id: string; sortKey: number; dayKey: string; item: StudyPlanItem };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO instant -> the value a <input type="datetime-local"> expects, in the user's OWN
 * local time. Deliberately not `toISOString().slice(0, 16)`, which would silently show a
 * 2pm event as 6pm for anyone east of UTC. */
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** The inverse: a datetime-local value is a wall-clock time with no zone, so `new Date()`
 * interprets it in the browser's zone (which is what the student meant) and toISOString
 * pins it to a real instant for the backend. That instant is what ends up in the ICS feed,
 * so a 2pm class stays 2pm on their phone. */
function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}

function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDayHeading(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  if (dayKeyOf(today) === dayKey) return "Today";
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (dayKeyOf(tomorrow) === dayKey) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatTimeRange(event: CalendarEvent): string {
  const start = new Date(event.start_at);
  if (Number.isNaN(start.getTime())) return "";
  const startText = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!event.end_at) return startText;
  const end = new Date(event.end_at);
  if (Number.isNaN(end.getTime())) return startText;
  return `${startText} – ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

const EMPTY_FORM = { title: "", start: "", end: "", notes: "" };

/** The student's own schedule: create, edit and delete real calendar events, shown as a
 * date-grouped agenda alongside the deadlines already extracted into their study plan.
 *
 * SCOPE NOTE (deliberate): this is an agenda/list view, not a drag-and-drop month grid.
 * A month grid is a genuinely large piece of UI — overflow handling, multi-day spans, drag
 * targets, keyboard navigation — and none of it changes what a student can actually record
 * or what reaches their phone through the ICS feed. A list that groups by day, sorts by
 * time, and does real CRUD is the honest v1; the month grid is a visual upgrade that can
 * land later without touching the data model or the feed.
 *
 * Follows StudyPlanPanel's shape exactly (same modal chrome, same item-list/item-row
 * classes, same "load once on mount, mutate locally after a successful call" flow) rather
 * than inventing a second convention for what is structurally the same kind of panel. */
function CalendarPanel({ token, onClose }: CalendarPanelProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [planItems, setPlanItems] = useState<StudyPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  /** The id of the event currently open in the form, or null when it's a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCalendarEvents(token)
      .then((result) => {
        if (!cancelled) setEvents(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load your calendar.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    listStudyPlan(token)
      .then((result) => {
        if (!cancelled) setPlanItems(result);
      })
      .catch(() => {
        // Non-fatal: the student's own events are the point of this panel, and they
        // should still be usable if the study-plan fetch happens to fail.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const grouped = useMemo(() => {
    const entries: AgendaEntry[] = [];

    for (const event of events) {
      const start = new Date(event.start_at);
      if (Number.isNaN(start.getTime())) continue;
      entries.push({
        kind: "event",
        id: event.id,
        sortKey: start.getTime(),
        dayKey: dayKeyOf(start),
        event,
      });
    }

    for (const item of planItems) {
      // Only items with a real parsed date can be placed on a day. The "Week 5" ones stay
      // in the Study plan panel rather than being guessed onto an invented date here.
      if (!item.due_date) continue;
      const [year, month, day] = item.due_date.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      if (Number.isNaN(date.getTime())) continue;
      entries.push({
        kind: "plan",
        id: item.id,
        // All-day items sort to the top of their day.
        sortKey: date.getTime(),
        dayKey: dayKeyOf(date),
        item,
      });
    }

    entries.sort((a, b) => a.sortKey - b.sortKey);

    const days: { dayKey: string; entries: AgendaEntry[] }[] = [];
    for (const entry of entries) {
      const last = days[days.length - 1];
      if (last && last.dayKey === entry.dayKey) last.entries.push(entry);
      else days.push({ dayKey: entry.dayKey, entries: [entry] });
    }
    return days;
  }, [events, planItems]);

  function openNewEventForm() {
    // Default to the next whole hour — the overwhelmingly common case is "something later
    // today", and an empty required field is a worse starting point than a sensible guess.
    const next = new Date();
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    setForm({ ...EMPTY_FORM, start: toLocalInputValue(next.toISOString()) });
    setEditingId(null);
    setShowForm(true);
  }

  function openEditForm(event: CalendarEvent) {
    setForm({
      title: event.title,
      start: toLocalInputValue(event.start_at),
      end: event.end_at ? toLocalInputValue(event.end_at) : "",
      notes: event.notes ?? "",
    });
    setEditingId(event.id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !form.title.trim() || !form.start) return;
    setSaving(true);
    setError(null);
    const payload = {
      title: form.title.trim(),
      start_at: fromLocalInputValue(form.start),
      // An empty end field means "no end time" — sent as an explicit null so an edit can
      // genuinely CLEAR a previously-set end, not just fail to change it.
      end_at: form.end ? fromLocalInputValue(form.end) : null,
      notes: form.notes.trim() ? form.notes.trim() : null,
    };
    try {
      if (editingId) {
        const updated = await updateCalendarEvent(token, editingId, payload);
        setEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)));
      } else {
        const created = await createCalendarEvent(token, payload);
        setEvents((prev) => [...prev, created]);
      }
      closeForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this event.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCalendarEvent(token, id);
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
      if (editingId === id) closeForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove this event.");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Calendar</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="modal-subtitle">
          Your own schedule, plus the deadlines from your study plan. Subscribe to it from your
          phone's calendar app in Settings → Calendar.
        </p>

        {error && <div className="banner banner--error">{error}</div>}

        {showForm ? (
          <form className="calendar-form" onSubmit={handleSubmit}>
            <label className="calendar-field">
              <span className="settings-toggle-label">Title</span>
              <input
                type="text"
                className="settings-delete-input"
                value={form.title}
                autoFocus
                maxLength={500}
                placeholder="Chem lab"
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </label>

            <div className="calendar-field-row">
              <label className="calendar-field">
                <span className="settings-toggle-label">Starts</span>
                <input
                  type="datetime-local"
                  className="settings-delete-input"
                  value={form.start}
                  onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                />
              </label>
              <label className="calendar-field">
                <span className="settings-toggle-label">Ends (optional)</span>
                <input
                  type="datetime-local"
                  className="settings-delete-input"
                  value={form.end}
                  onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                />
              </label>
            </div>

            <label className="calendar-field">
              <span className="settings-toggle-label">Notes (optional)</span>
              <input
                type="text"
                className="settings-delete-input"
                value={form.notes}
                placeholder="Bring goggles"
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>

            <div className="settings-delete-actions">
              <button type="button" className="btn-secondary" onClick={closeForm} disabled={saving}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={saving || !form.title.trim() || !form.start}
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Add event"}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn-primary calendar-add-btn" onClick={openNewEventForm}>
            <span aria-hidden="true">+</span> New event
          </button>
        )}

        {loading ? (
          <p className="empty-state-text">Loading…</p>
        ) : grouped.length === 0 ? (
          <p className="empty-state-text">
            Nothing scheduled yet — add your first event above.
          </p>
        ) : (
          <div className="calendar-agenda">
            {grouped.map((day) => (
              <section key={day.dayKey} className="calendar-day">
                <h3 className="calendar-day-heading">{formatDayHeading(day.dayKey)}</h3>
                <ul className="item-list">
                  {day.entries.map((entry) =>
                    entry.kind === "event" ? (
                      <li key={`event-${entry.id}`} className="item-row item-row--stacked">
                        <div className="item-row-main">
                          <div>
                            <div className="item-title">{entry.event.title}</div>
                            <div className="item-meta">{formatTimeRange(entry.event)}</div>
                          </div>
                          <div className="item-row-actions">
                            <button
                              type="button"
                              className="btn-secondary-sm"
                              onClick={() => openEditForm(entry.event)}
                              aria-label={`Edit ${entry.event.title}`}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-secondary-sm btn-secondary-sm--danger"
                              onClick={() => handleDelete(entry.event.id)}
                              aria-label={`Delete ${entry.event.title}`}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        {entry.event.notes && <div className="item-status">{entry.event.notes}</div>}
                      </li>
                    ) : (
                      <li key={`plan-${entry.id}`} className="item-row item-row--stacked">
                        <div className="item-row-main">
                          <div>
                            <div className="item-title">{entry.item.title}</div>
                            <div className="item-meta">Due · from your study plan</div>
                          </div>
                        </div>
                        {entry.item.notes && <div className="item-status">{entry.item.notes}</div>}
                      </li>
                    ),
                  )}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CalendarPanel;
