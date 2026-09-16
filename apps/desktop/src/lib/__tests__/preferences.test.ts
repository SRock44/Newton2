import { describe, it, expect, beforeEach } from "vitest";
import {
  ACCENT_PRESETS,
  CONTEXT_PANEL_DEFAULT_WIDTH,
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  applyAppearance,
  applyStoredAppearance,
  clampPanelWidth,
  getAccentPreset,
  getContextPanelWidth,
  getSidebarWidth,
  getThemePreference,
  setAccentPreset,
  setContextPanelWidth,
  setSidebarWidth,
  setThemePreference,
} from "../preferences";

describe("panel width preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the shipped widths when nothing has been persisted", () => {
    expect(getSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(getContextPanelWidth()).toBe(CONTEXT_PANEL_DEFAULT_WIDTH);
  });

  it("round-trips a width through localStorage", () => {
    setSidebarWidth(300);
    expect(getSidebarWidth()).toBe(300);

    setContextPanelWidth(260);
    expect(getContextPanelWidth()).toBe(260);
  });

  it("keeps the two panels' widths independent of each other", () => {
    setSidebarWidth(400);
    setContextPanelWidth(180);

    expect(getSidebarWidth()).toBe(400);
    expect(getContextPanelWidth()).toBe(180);
  });

  it("clamps on write, so an out-of-range value can never be stored", () => {
    setSidebarWidth(9999);
    expect(getSidebarWidth()).toBe(SIDEBAR_MAX_WIDTH);

    setSidebarWidth(1);
    expect(getSidebarWidth()).toBe(SIDEBAR_MIN_WIDTH);

    setContextPanelWidth(-40);
    expect(getContextPanelWidth()).toBe(CONTEXT_PANEL_MIN_WIDTH);

    setContextPanelWidth(10000);
    expect(getContextPanelWidth()).toBe(CONTEXT_PANEL_MAX_WIDTH);
  });

  it("clamps on read too, so a hand-edited or corrupt stored value can't render an unusable panel", () => {
    window.localStorage.setItem("newton:prefs:sidebarWidth", "4");
    expect(getSidebarWidth()).toBe(SIDEBAR_MIN_WIDTH);

    window.localStorage.setItem("newton:prefs:sidebarWidth", "3000");
    expect(getSidebarWidth()).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("falls back to the default for a non-numeric stored value rather than rendering NaN", () => {
    window.localStorage.setItem("newton:prefs:contextPanelWidth", "wide-please");
    expect(getContextPanelWidth()).toBe(CONTEXT_PANEL_DEFAULT_WIDTH);
  });

  it("rounds fractional drag positions to whole pixels", () => {
    setSidebarWidth(250.7);
    expect(getSidebarWidth()).toBe(251);
  });

  it("clampPanelWidth itself is total: NaN/Infinity resolve to the minimum", () => {
    expect(clampPanelWidth(Number.NaN, 100, 200)).toBe(100);
    expect(clampPanelWidth(Number.POSITIVE_INFINITY, 100, 200)).toBe(200);
    expect(clampPanelWidth(150, 100, 200)).toBe(150);
  });
});

describe("appearance preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-accent");
  });

  it("defaults to following the OS ('system') with the original cobalt accent", () => {
    expect(getThemePreference()).toBe("system");
    expect(getAccentPreset()).toBe("cobalt");
  });

  it("round-trips theme and accent choices", () => {
    setThemePreference("dark");
    setAccentPreset("teal");

    expect(getThemePreference()).toBe("dark");
    expect(getAccentPreset()).toBe("teal");
  });

  it("ignores an unrecognised stored theme or accent instead of applying it", () => {
    window.localStorage.setItem("newton:prefs:theme", "solarized");
    window.localStorage.setItem("newton:prefs:accent", "hotpink");

    expect(getThemePreference()).toBe("system");
    expect(getAccentPreset()).toBe("cobalt");
  });

  it("applyAppearance writes data-theme/data-accent onto <html>", () => {
    applyAppearance("dark", "violet");

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-accent")).toBe("violet");
  });

  it("'system' REMOVES data-theme, so the stylesheet falls through to prefers-color-scheme", () => {
    applyAppearance("dark", "cobalt");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    applyAppearance("system", "cobalt");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("the default 'cobalt' accent REMOVES data-accent, leaving the base :root palette", () => {
    applyAppearance("light", "amber");
    expect(document.documentElement.getAttribute("data-accent")).toBe("amber");

    applyAppearance("light", "cobalt");
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
  });

  it("applyStoredAppearance replays what was persisted — the startup path", () => {
    setThemePreference("light");
    setAccentPreset("forest");

    applyStoredAppearance();

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-accent")).toBe("forest");
  });

  it("offers five presets, keeps cobalt first as the default, and every id is unique", () => {
    expect(ACCENT_PRESETS).toHaveLength(5);
    expect(ACCENT_PRESETS[0].id).toBe("cobalt");
    expect(new Set(ACCENT_PRESETS.map((p) => p.id)).size).toBe(5);
    // Every swatch is a real hex color the picker can paint.
    for (const preset of ACCENT_PRESETS) {
      expect(preset.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
