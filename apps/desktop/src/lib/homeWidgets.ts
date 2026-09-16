/** How the home dashboard's curated widgets (see HomeView.tsx) are laid out for a given
 * student: which are shown, in what ORDER, and at what SIZE.
 *
 * Order and size are new. The original scoping decision here was visibility-only —
 * explicitly "not a drag-and-drop layout engine" — and that has now been superseded by
 * direct product direction to build drag-to-reorder anyway. The widget LIST is still
 * curated and fixed (you can't add or author widgets); what's customizable is which of
 * them appear, where, and how wide.
 *
 * Persisted the same local, per-account way lib/onboarding.ts already established for
 * this class of preference ("local UI preference, not account data"): keyed by the
 * student's stable JWT `sub` claim, passed in as `userId` by every caller here exactly
 * as App.tsx already derives it for onboarding (see userIdFromAccessToken) — never
 * synced to the backend. Each of the three concerns gets its own localStorage key under
 * the same prefix, so a corrupt/unparseable order can't also take visibility down with
 * it, and an older build that only knows about visibility keeps working unchanged. */

export type HomeWidgetId = "recent" | "conversations" | "dueSoon" | "progress" | "quickActions";

export const HOME_WIDGET_IDS: HomeWidgetId[] = ["recent", "conversations", "dueSoon", "progress", "quickActions"];

export const HOME_WIDGET_LABELS: Record<HomeWidgetId, string> = {
  recent: "Recent documents & notes",
  conversations: "Continue a conversation",
  dueSoon: "Due soon",
  progress: "Your progress",
  quickActions: "Quick actions",
};

/** The dashboard's original top-to-bottom VISUAL order, which is deliberately not the
 * same as HOME_WIDGET_IDS above: that array is the canonical set (and the order the
 * Customize list happened to use), while the hand-composed layout has always led with
 * Quick actions. Defaulting the persisted order to this — not to HOME_WIDGET_IDS — is
 * what makes an untouched account render exactly the dashboard it rendered before this
 * feature existed. */
export const DEFAULT_HOME_WIDGET_ORDER: HomeWidgetId[] = [
  "quickActions",
  "recent",
  "conversations",
  "dueSoon",
  "progress",
];

/** A widget's footprint in HomeView's 3-column grid: "wide" spans all three columns,
 * "compact" takes one. This is a per-student choice, not a fixed property of the widget
 * — see getHomeWidgetSizes below for why it has to be. */
export type HomeWidgetSize = "wide" | "compact";

/** The shipped defaults reproduce the dashboard's existing hand-composed layout exactly:
 * a full-width Quick actions row, a full-width Recent row, then conversations/due
 * soon/progress as one deliberate row of three. So a student who never touches
 * Customize sees precisely what they saw before this feature existed. */
export const DEFAULT_HOME_WIDGET_SIZES: Record<HomeWidgetId, HomeWidgetSize> = {
  quickActions: "wide",
  recent: "wide",
  conversations: "compact",
  dueSoon: "compact",
  progress: "compact",
};

const KEY_PREFIX = "newton:prefs:homeWidgets:";
const ORDER_KEY_PREFIX = "newton:prefs:homeWidgetOrder:";
const SIZES_KEY_PREFIX = "newton:prefs:homeWidgetSizes:";

function defaultVisibility(): Record<HomeWidgetId, boolean> {
  return Object.fromEntries(HOME_WIDGET_IDS.map((id) => [id, true])) as Record<HomeWidgetId, boolean>;
}

/** Every widget defaults ON — a hidden widget is always an explicit student choice
 * recorded via setHomeWidgetVisibility below, never a silent default. */
export function getHomeWidgetVisibility(userId: string): Record<HomeWidgetId, boolean> {
  const defaults = defaultVisibility();
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<Record<HomeWidgetId, boolean>>;
    return { ...defaults, ...saved };
  } catch {
    // Storage unavailable, or a corrupt entry — fail toward showing everything rather
    // than silently hiding widgets a student never chose to hide.
    return defaults;
  }
}

export function setHomeWidgetVisibility(userId: string, visibility: Record<HomeWidgetId, boolean>): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(visibility));
  } catch {
    // Best-effort only — same as lib/onboarding.ts's markOnboardingSeen; worst case the
    // choice doesn't stick across launches.
  }
}

/** Reconciles a persisted order against the current HOME_WIDGET_IDS: keeps the saved
 * relative order of ids that still exist, drops ids that no longer do, and appends any
 * widget the saved order never knew about (in its canonical position's order) at the
 * end. That's what makes it safe to add a sixth widget in a future release without a
 * migration — an existing student just finds the new widget at the bottom of their
 * dashboard rather than losing their arrangement or not seeing it at all. Exported for
 * its own direct tests, since every guarantee this feature makes lives here. */
export function normalizeHomeWidgetOrder(saved: unknown): HomeWidgetId[] {
  const known = new Set<string>(HOME_WIDGET_IDS);
  const seen = new Set<HomeWidgetId>();
  const result: HomeWidgetId[] = [];
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id === "string" && known.has(id) && !seen.has(id as HomeWidgetId)) {
        seen.add(id as HomeWidgetId);
        result.push(id as HomeWidgetId);
      }
    }
  }
  for (const id of DEFAULT_HOME_WIDGET_ORDER) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

/** The student's drag-chosen widget order. Defaults to DEFAULT_HOME_WIDGET_ORDER — the
 * dashboard's original hand-composed layout — so an untouched account renders exactly
 * what it always did. Covers hidden widgets too: hiding a widget and showing it again
 * puts it back where it was rather than at the end. */
export function getHomeWidgetOrder(userId: string): HomeWidgetId[] {
  try {
    const raw = window.localStorage.getItem(ORDER_KEY_PREFIX + userId);
    if (!raw) return [...DEFAULT_HOME_WIDGET_ORDER];
    return normalizeHomeWidgetOrder(JSON.parse(raw));
  } catch {
    // Storage unavailable, or a corrupt entry — fall back to the canonical order rather
    // than rendering an arbitrary one.
    return [...DEFAULT_HOME_WIDGET_ORDER];
  }
}

export function setHomeWidgetOrder(userId: string, order: HomeWidgetId[]): void {
  try {
    window.localStorage.setItem(ORDER_KEY_PREFIX + userId, JSON.stringify(normalizeHomeWidgetOrder(order)));
  } catch {
    // Best-effort only — worst case the arrangement doesn't stick across launches.
  }
}

/** Per-widget grid footprint. This exists because arbitrary reordering and a fixed
 * 3-column grid are in direct tension: a widget pinned to the full width forces a new
 * grid row, so dragging a compact widget above a wide one can leave one or two visibly
 * empty cells in the row above it. Rather than either forbidding that (locking wide
 * widgets into their own zone, which makes the drag feel arbitrary) or letting the grid
 * silently reflow around it (`grid-auto-flow: dense`, which contradicts the order the
 * student just chose by eye), the size is simply exposed: any hole is now something the
 * student can close deliberately by widening its neighbour. */
export function getHomeWidgetSizes(userId: string): Record<HomeWidgetId, HomeWidgetSize> {
  try {
    const raw = window.localStorage.getItem(SIZES_KEY_PREFIX + userId);
    if (!raw) return { ...DEFAULT_HOME_WIDGET_SIZES };
    const saved = JSON.parse(raw) as Partial<Record<HomeWidgetId, unknown>>;
    const result = { ...DEFAULT_HOME_WIDGET_SIZES };
    for (const id of HOME_WIDGET_IDS) {
      if (saved[id] === "wide" || saved[id] === "compact") result[id] = saved[id];
    }
    return result;
  } catch {
    return { ...DEFAULT_HOME_WIDGET_SIZES };
  }
}

export function setHomeWidgetSizes(userId: string, sizes: Record<HomeWidgetId, HomeWidgetSize>): void {
  try {
    window.localStorage.setItem(SIZES_KEY_PREFIX + userId, JSON.stringify(sizes));
  } catch {
    // Best-effort only — worst case the choice doesn't stick across launches.
  }
}
