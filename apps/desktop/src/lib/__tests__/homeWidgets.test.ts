import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_HOME_WIDGET_SIZES,
  DEFAULT_HOME_WIDGET_ORDER,
  HOME_WIDGET_IDS,
  getHomeWidgetOrder,
  getHomeWidgetSizes,
  getHomeWidgetVisibility,
  normalizeHomeWidgetOrder,
  setHomeWidgetOrder,
  setHomeWidgetSizes,
  setHomeWidgetVisibility,
} from "../homeWidgets";
import type { HomeWidgetId } from "../homeWidgets";

describe("widget id lists", () => {
  it("the default order covers exactly the canonical widget set — neither can drift from the other", () => {
    expect([...DEFAULT_HOME_WIDGET_ORDER].sort()).toEqual([...HOME_WIDGET_IDS].sort());
  });

  it("leads with Quick actions, matching the dashboard's original hand-composed layout", () => {
    expect(DEFAULT_HOME_WIDGET_ORDER[0]).toBe("quickActions");
    expect(DEFAULT_HOME_WIDGET_ORDER[1]).toBe("recent");
  });
});

describe("normalizeHomeWidgetOrder", () => {
  it("keeps a complete, valid order exactly as given", () => {
    const order: HomeWidgetId[] = ["progress", "dueSoon", "recent", "quickActions", "conversations"];
    expect(normalizeHomeWidgetOrder(order)).toEqual(order);
  });

  it("appends widgets the saved order never knew about, so a new widget can ship without a migration", () => {
    expect(normalizeHomeWidgetOrder(["progress", "dueSoon"])).toEqual([
      "progress",
      "dueSoon",
      ...DEFAULT_HOME_WIDGET_ORDER.filter((id) => id !== "progress" && id !== "dueSoon"),
    ]);
  });

  it("drops ids that no longer exist rather than rendering an unknown widget", () => {
    expect(normalizeHomeWidgetOrder(["progress", "horoscope", "dueSoon"])).not.toContain("horoscope");
    expect(normalizeHomeWidgetOrder(["progress", "horoscope", "dueSoon"])).toHaveLength(DEFAULT_HOME_WIDGET_ORDER.length);
  });

  it("de-duplicates a repeated id, so a widget can never render twice", () => {
    const result = normalizeHomeWidgetOrder(["progress", "progress", "dueSoon"]);
    expect(result.filter((id) => id === "progress")).toHaveLength(1);
    expect(result).toHaveLength(DEFAULT_HOME_WIDGET_ORDER.length);
  });

  it("falls back to the canonical order for junk input", () => {
    expect(normalizeHomeWidgetOrder(null)).toEqual(DEFAULT_HOME_WIDGET_ORDER);
    expect(normalizeHomeWidgetOrder("progress")).toEqual(DEFAULT_HOME_WIDGET_ORDER);
    expect(normalizeHomeWidgetOrder([1, 2, 3])).toEqual(DEFAULT_HOME_WIDGET_ORDER);
  });
});

describe("home widget order persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the dashboard's original hand-composed order", () => {
    expect(getHomeWidgetOrder("user-1")).toEqual(DEFAULT_HOME_WIDGET_ORDER);
  });

  it("round-trips a dragged order", () => {
    const order: HomeWidgetId[] = ["dueSoon", "progress", "quickActions", "conversations", "recent"];
    setHomeWidgetOrder("user-1", order);
    expect(getHomeWidgetOrder("user-1")).toEqual(order);
  });

  it("is scoped per user, the same way visibility already is", () => {
    setHomeWidgetOrder("user-a", ["progress", "dueSoon", "conversations", "recent", "quickActions"]);
    expect(getHomeWidgetOrder("user-b")).toEqual(DEFAULT_HOME_WIDGET_ORDER);
  });

  it("normalizes a corrupt stored order back to something renderable", () => {
    window.localStorage.setItem("newton:prefs:homeWidgetOrder:user-1", "{not json");
    expect(getHomeWidgetOrder("user-1")).toEqual(DEFAULT_HOME_WIDGET_ORDER);
  });

  it("order and visibility are stored independently — reordering doesn't disturb hidden widgets", () => {
    setHomeWidgetVisibility("user-1", {
      ...getHomeWidgetVisibility("user-1"),
      dueSoon: false,
    });
    setHomeWidgetOrder("user-1", ["progress", "dueSoon", "conversations", "recent", "quickActions"]);

    expect(getHomeWidgetVisibility("user-1").dueSoon).toBe(false);
    expect(getHomeWidgetOrder("user-1")[0]).toBe("progress");
  });
});

describe("home widget sizes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults reproduce the dashboard's existing layout: quick actions + recent wide, the rest compact", () => {
    const sizes = getHomeWidgetSizes("user-1");
    expect(sizes).toEqual(DEFAULT_HOME_WIDGET_SIZES);
    expect(sizes.quickActions).toBe("wide");
    expect(sizes.recent).toBe("wide");
    expect(sizes.conversations).toBe("compact");
    expect(sizes.dueSoon).toBe("compact");
    expect(sizes.progress).toBe("compact");
  });

  it("round-trips a changed size", () => {
    setHomeWidgetSizes("user-1", { ...DEFAULT_HOME_WIDGET_SIZES, progress: "wide" });
    expect(getHomeWidgetSizes("user-1").progress).toBe("wide");
    // Everything else is untouched.
    expect(getHomeWidgetSizes("user-1").recent).toBe("wide");
    expect(getHomeWidgetSizes("user-1").dueSoon).toBe("compact");
  });

  it("is scoped per user", () => {
    setHomeWidgetSizes("user-a", { ...DEFAULT_HOME_WIDGET_SIZES, progress: "wide" });
    expect(getHomeWidgetSizes("user-b").progress).toBe("compact");
  });

  it("ignores a stored value that isn't a known size, keeping that widget's default", () => {
    window.localStorage.setItem(
      "newton:prefs:homeWidgetSizes:user-1",
      JSON.stringify({ progress: "enormous", dueSoon: "wide" }),
    );
    const sizes = getHomeWidgetSizes("user-1");
    expect(sizes.progress).toBe("compact");
    expect(sizes.dueSoon).toBe("wide");
  });

  it("falls back to the defaults for a corrupt entry", () => {
    window.localStorage.setItem("newton:prefs:homeWidgetSizes:user-1", "{not json");
    expect(getHomeWidgetSizes("user-1")).toEqual(DEFAULT_HOME_WIDGET_SIZES);
  });
});
