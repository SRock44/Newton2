/** A study-plan deadline is a plain calendar date ("2026-02-06"), which `new Date()` reads as
 * midnight UTC — so anywhere west of UTC it lands on the PREVIOUS evening ("Feb 6" showed as
 * "Feb 5" on Home, and a "due within 3 days" reminder fired hours early). A date-only string means
 * that day in the student's own timezone (the Study plan panel already reads it that way);
 * anything with a time is a real instant and parses as-is. */
export function parseDueDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}
