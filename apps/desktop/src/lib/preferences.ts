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

const CONTEXT_PANEL_COLLAPSED_KEY = "newton:prefs:contextPanelCollapsed";

/** Whether ContextPanel.tsx (the right "Newton context" rail) is collapsed to a slim
 * rail — window chrome, same rationale/pattern as getSidebarCollapsed above, just for
 * the opposite edge of the window. Defaults to expanded. */
export function getContextPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(CONTEXT_PANEL_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setContextPanelCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(CONTEXT_PANEL_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Best-effort only — worst case the preference doesn't stick across launches.
  }
}

/* ---------- Panel widths (drag-to-resize) ----------
 *
 * The collapse booleans above are all-or-nothing; these are the continuous version of
 * the same idea, for the two flanking panels that a student may want wider (a long
 * chat list) or narrower (more room for the document viewer). Same "window chrome, not
 * account data, not keyed by user id" rationale as getSidebarCollapsed.
 *
 * The clamps live here rather than only in CSS so a corrupt/hand-edited localStorage
 * value can never render an unusable 4px or 2000px panel: every read goes through
 * clampPanelWidth. SIDEBAR_MIN_WIDTH deliberately matches App.css's `.sidebar`
 * `min-width`, so CSS and JS agree on the floor instead of one silently overriding the
 * other. */

export const SIDEBAR_DEFAULT_WIDTH = 236;
export const SIDEBAR_MIN_WIDTH = 188;
export const SIDEBAR_MAX_WIDTH = 420;

export const CONTEXT_PANEL_DEFAULT_WIDTH = 208;
export const CONTEXT_PANEL_MIN_WIDTH = 168;
export const CONTEXT_PANEL_MAX_WIDTH = 420;

export function clampPanelWidth(width: number, min: number, max: number): number {
  // NaN is the only value Math.min/Math.max can't resolve sensibly (it propagates), so
  // it's handled explicitly; ±Infinity clamps to max/min on its own.
  if (Number.isNaN(width)) return min;
  return Math.round(Math.min(max, Math.max(min, width)));
}

function readWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return clampPanelWidth(parsed, min, max);
  } catch {
    return fallback;
  }
}

function writeWidth(key: string, width: number, min: number, max: number): void {
  try {
    window.localStorage.setItem(key, String(clampPanelWidth(width, min, max)));
  } catch {
    // Best-effort only — worst case the preference doesn't stick across launches.
  }
}

const SIDEBAR_WIDTH_KEY = "newton:prefs:sidebarWidth";

/** Expanded-sidebar width in px (see Sidebar.tsx's drag handle). Only meaningful while
 * expanded — the collapsed rail is a fixed 56px in CSS and ignores this entirely. */
export function getSidebarWidth(): number {
  return readWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
}

export function setSidebarWidth(width: number): void {
  writeWidth(SIDEBAR_WIDTH_KEY, width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
}

const CONTEXT_PANEL_WIDTH_KEY = "newton:prefs:contextPanelWidth";

/** Expanded "Newton context" panel width in px — mirrors getSidebarWidth for the
 * opposite edge of the window (its drag handle is on its LEFT edge). */
export function getContextPanelWidth(): number {
  return readWidth(
    CONTEXT_PANEL_WIDTH_KEY,
    CONTEXT_PANEL_DEFAULT_WIDTH,
    CONTEXT_PANEL_MIN_WIDTH,
    CONTEXT_PANEL_MAX_WIDTH,
  );
}

export function setContextPanelWidth(width: number): void {
  writeWidth(CONTEXT_PANEL_WIDTH_KEY, width, CONTEXT_PANEL_MIN_WIDTH, CONTEXT_PANEL_MAX_WIDTH);
}

/* ---------- Appearance (theme + accent) ---------- */

export type ThemePreference = "light" | "dark" | "system";

export type AccentPresetId = "cobalt" | "forest" | "violet" | "amber" | "teal";

/** The accent presets offered in Settings → Appearance. Each id maps to a
 * `:root[data-accent="…"]` block in App.css that swaps the whole
 * --color-accent/-hover/-active/-tint/-tint-strong set at once (in BOTH light and dark
 * variants) — this list is only the label + the swatch color shown in the picker, never
 * a second source of truth for the actual palette. "cobalt" is the app's existing
 * default and therefore has no CSS block of its own: it's simply the base :root values.
 * `swatch` is the light-mode base color, matching what a light-mode user sees. */
export const ACCENT_PRESETS: { id: AccentPresetId; label: string; swatch: string }[] = [
  { id: "cobalt", label: "Cobalt", swatch: "#2f4d8c" },
  { id: "forest", label: "Forest", swatch: "#2f6b46" },
  { id: "violet", label: "Violet", swatch: "#5a4292" },
  { id: "amber", label: "Amber", swatch: "#9a6414" },
  { id: "teal", label: "Teal", swatch: "#1f6b73" },
];

const THEME_KEY = "newton:prefs:theme";
const ACCENT_KEY = "newton:prefs:accent";

const THEME_VALUES: ThemePreference[] = ["light", "dark", "system"];

/** Defaults to "system" — i.e. no override at all, exactly today's behavior, where
 * App.css's `@media (prefers-color-scheme: dark)` follows the OS. */
export function getThemePreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return THEME_VALUES.includes(raw as ThemePreference) ? (raw as ThemePreference) : "system";
  } catch {
    return "system";
  }
}

export function setThemePreference(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Best-effort only — worst case the preference doesn't stick across launches.
  }
}

export function getAccentPreset(): AccentPresetId {
  try {
    const raw = window.localStorage.getItem(ACCENT_KEY);
    return ACCENT_PRESETS.some((p) => p.id === raw) ? (raw as AccentPresetId) : "cobalt";
  } catch {
    return "cobalt";
  }
}

export function setAccentPreset(accent: AccentPresetId): void {
  try {
    window.localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // Best-effort only — worst case the preference doesn't stick across launches.
  }
}

/** Writes the two appearance choices onto <html> as `data-theme` / `data-accent`, which
 * is all App.css needs to swap palettes. "system" REMOVES data-theme rather than setting
 * it to some third value, so the stylesheet falls straight through to its existing
 * `@media (prefers-color-scheme: dark)` block — meaning "system" is genuinely the
 * old behavior, not a JS reimplementation of it. Likewise the default "cobalt" accent
 * removes data-accent and lets the base :root values stand.
 *
 * Called once at startup (main.tsx, before React mounts, so there's no light-mode flash)
 * and again on every change from SettingsPanel. Deliberately reads its own arguments
 * rather than localStorage so callers can preview a choice before persisting it. */
export function applyAppearance(theme: ThemePreference, accent: AccentPresetId): void {
  try {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    if (accent === "cobalt") root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", accent);
  } catch {
    // No DOM (or a locked-down document) — nothing to theme.
  }
}

/** Startup convenience: apply whatever was last persisted. */
export function applyStoredAppearance(): void {
  applyAppearance(getThemePreference(), getAccentPreset());
}

export type DocumentsViewMode = "grid" | "list";

const DOCUMENTS_VIEW_MODE_KEY = "newton:prefs:documentsViewMode";

/** Grid (thumbnail tiles) vs. list (compact rows) for DocumentsPanel's file browser —
 * window chrome, not account data, same rationale as getSidebarCollapsed above.
 * Defaults to grid, the more Drive-like first impression. */
export function getDocumentsViewMode(): DocumentsViewMode {
  try {
    return window.localStorage.getItem(DOCUMENTS_VIEW_MODE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function setDocumentsViewMode(mode: DocumentsViewMode): void {
  try {
    window.localStorage.setItem(DOCUMENTS_VIEW_MODE_KEY, mode);
  } catch {
    // Best-effort only — worst case the preference doesn't stick across launches.
  }
}
