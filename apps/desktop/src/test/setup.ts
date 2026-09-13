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
