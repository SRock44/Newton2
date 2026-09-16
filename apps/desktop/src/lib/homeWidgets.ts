/** Which of the home dashboard's curated widgets (see HomeView.tsx) a student has
 * chosen to show or hide. "Customizable" here means a fixed set of on/off toggles on a
 * curated widget list — a confirmed, deliberate scoping decision, not a drag-and-drop
 * layout engine: no persisted widget positions/ordering, just per-widget visibility.
 *
 * Persisted the same local, per-account way lib/onboarding.ts already established for
 * this class of preference ("local UI preference, not account data"): keyed by the
 * student's stable JWT `sub` claim, passed in as `userId` by every caller here exactly
 * as App.tsx already derives it for onboarding (see userIdFromAccessToken) — never
 * synced to the backend. */

export type HomeWidgetId = "recent" | "conversations" | "dueSoon" | "progress" | "quickActions";

export const HOME_WIDGET_IDS: HomeWidgetId[] = ["recent", "conversations", "dueSoon", "progress", "quickActions"];

export const HOME_WIDGET_LABELS: Record<HomeWidgetId, string> = {
  recent: "Recent documents & notes",
  conversations: "Continue a conversation",
  dueSoon: "Due soon",
  progress: "Your progress",
  quickActions: "Quick actions",
};

const KEY_PREFIX = "newton:prefs:homeWidgets:";

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
