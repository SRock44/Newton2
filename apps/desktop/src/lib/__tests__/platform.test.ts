import { describe, it, expect, vi, beforeEach } from "vitest";

const openUrl = vi.fn(async (_url: string) => undefined);
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));

import { isTauri, openExternal } from "../platform";

describe("isTauri", () => {
  it("is true under this suite's default stub (test/setup.ts simulates the desktop build)", () => {
    expect(isTauri()).toBe(true);
  });

  it("is false once the Tauri bridge is removed (the real plain-browser case)", () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    try {
      expect(isTauri()).toBe(false);
    } finally {
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, writable: true, configurable: true });
    }
  });
});

describe("openExternal", () => {
  beforeEach(() => {
    openUrl.mockClear();
    openUrl.mockResolvedValue(undefined);
  });

  it("opens via the Tauri plugin (the real system browser) when running inside Tauri", async () => {
    const windowOpenSpy = vi.spyOn(window, "open");
    await openExternal("https://checkout.stripe.com/session123");

    expect(openUrl).toHaveBeenCalledWith("https://checkout.stripe.com/session123");
    expect(windowOpenSpy).not.toHaveBeenCalled();
    windowOpenSpy.mockRestore();
  });

  it("opens via window.open in a new tab on the web, never touching the Tauri plugin", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const windowOpenSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);

    try {
      await openExternal("https://checkout.stripe.com/session123");
      expect(windowOpenSpy).toHaveBeenCalledWith(
        "https://checkout.stripe.com/session123",
        "_blank",
        "noopener,noreferrer",
      );
      expect(openUrl).not.toHaveBeenCalled();
    } finally {
      windowOpenSpy.mockRestore();
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, writable: true, configurable: true });
    }
  });

  it("throws when the browser blocks the pop-up (window.open returns null)", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const windowOpenSpy = vi.spyOn(window, "open").mockReturnValue(null);

    try {
      await expect(openExternal("https://checkout.stripe.com/session123")).rejects.toThrow(/pop-up/);
    } finally {
      windowOpenSpy.mockRestore();
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, writable: true, configurable: true });
    }
  });
});
