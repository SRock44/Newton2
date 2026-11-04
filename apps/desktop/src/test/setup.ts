import "@testing-library/jest-dom/vitest";

// Newer Node runtimes ship a built-in global `localStorage` (gated behind
// --localstorage-file) that can shadow jsdom's own working implementation with a stub
// whose methods throw/are missing when no backing file path is configured — breaking
// any component that persists via localStorage under this test runner specifically.
// The real desktop app always runs in a real WebView2/Chromium window with a real,
// working localStorage; this in-memory polyfill just keeps tests deterministic
// regardless of which Node version happens to run them.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

for (const prop of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(window, prop, {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}

// This is apps/desktop's own test suite — it exercises the Tauri build by default, the
// same assumption every existing Tauri-plugin mock in these tests already makes (e.g.
// SettingsPanel.test.tsx asserting its mocked `@tauri-apps/plugin-opener`'s `openUrl` was
// called). lib/platform.ts's isTauri() checks for this exact property, so stub it here —
// once, for the whole suite — rather than have every test file do it individually. A
// handful of tests cover the OTHER branch (apps/web's plain-browser behavior) by
// `delete`-ing this for just that one test and restoring it afterward — see e.g.
// lib/__tests__/download.test.ts and notifications.test.ts.
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {},
  writable: true,
  configurable: true,
});
