import "@testing-library/jest-dom/vitest";

// Same fix as apps/desktop/src/test/setup.ts (see its own comment for the full
// reasoning): a newer Node runtime's built-in `localStorage` can shadow jsdom's working
// one with a stub that throws/is missing, breaking anything that persists via it under
// this specific test runner. An in-memory polyfill keeps tests deterministic regardless
// of which Node version runs them.
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

// Deliberately NO __TAURI_INTERNALS__ stub here, unlike apps/desktop's setup.ts — this
// suite exercises the web build, where isTauri() (apps/desktop/src/lib/platform.ts)
// should see exactly what a real browser tab sees: no bridge at all. jsdom's default
// `window` already has none, so there is nothing to add.
