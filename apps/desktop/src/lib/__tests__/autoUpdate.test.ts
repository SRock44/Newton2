import { describe, it, expect, vi, beforeEach } from "vitest";

const check = vi.fn();
const relaunch = vi.fn(async () => undefined);
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));

import { checkForUpdateAndInstall } from "../autoUpdate";

describe("checkForUpdateAndInstall", () => {
  beforeEach(() => {
    check.mockReset();
    relaunch.mockClear();
  });

  it("does nothing outside Tauri (the real apps/web case) -- never even calls check()", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    try {
      await checkForUpdateAndInstall();
      expect(check).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, writable: true, configurable: true });
    }
  });

  it("does nothing when already up to date (check() resolves null)", async () => {
    check.mockResolvedValue(null);
    await checkForUpdateAndInstall();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("downloads, installs, and relaunches into a real available update", async () => {
    const downloadAndInstall = vi.fn(async () => undefined);
    check.mockResolvedValue({ downloadAndInstall });

    await checkForUpdateAndInstall();

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("never throws -- a network/update-server failure is swallowed, not fatal to startup", async () => {
    check.mockRejectedValue(new Error("network unreachable"));
    await expect(checkForUpdateAndInstall()).resolves.toBeUndefined();
  });
});
