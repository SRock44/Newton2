import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `setupMathKeyboardDock` keeps a module-level "wired" flag so real work happens at
 * most once per page load — `vi.resetModules()` + a fresh dynamic import per test
 * gives each test its own copy of that flag, rather than tests leaking state into
 * each other via the shared singleton. */
async function freshModule() {
  vi.resetModules();
  return import("../mathKeyboardDock");
}

function makeFakeKeyboard() {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    container: null as HTMLElement | null,
    visible: false,
    addEventListener: vi.fn((type: string, cb: () => void) => {
      (listeners[type] ??= []).push(cb);
    }),
    removeEventListener: vi.fn(),
    fireToggle() {
      (listeners["virtual-keyboard-toggle"] ?? []).forEach((cb) => cb());
    },
  };
}

describe("setupMathKeyboardDock", () => {
  const originalKb = window.mathVirtualKeyboard;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    (window as unknown as { mathVirtualKeyboard: unknown }).mathVirtualKeyboard = originalKb;
  });

  it("no-ops quietly when window.mathVirtualKeyboard isn't present (the mocked-mathlive test boundary)", async () => {
    (window as unknown as { mathVirtualKeyboard: unknown }).mathVirtualKeyboard = undefined;
    const dock = document.createElement("div");
    dock.id = "math-keyboard-dock";
    document.body.appendChild(dock);

    const { setupMathKeyboardDock } = await freshModule();
    expect(() => setupMathKeyboardDock()).not.toThrow();
    expect(dock.className).toBe("");
  });

  it("no-ops quietly when the dock element hasn't rendered yet", async () => {
    const kb = makeFakeKeyboard();
    (window as unknown as { mathVirtualKeyboard: unknown }).mathVirtualKeyboard = kb;

    const { setupMathKeyboardDock } = await freshModule();
    expect(() => setupMathKeyboardDock()).not.toThrow();
    expect(kb.container).toBeNull();
  });

  it("retargets the singleton's container at the dock element and syncs visibility from its real events", async () => {
    const kb = makeFakeKeyboard();
    (window as unknown as { mathVirtualKeyboard: unknown }).mathVirtualKeyboard = kb;
    const dock = document.createElement("div");
    dock.id = "math-keyboard-dock";
    document.body.appendChild(dock);

    const { setupMathKeyboardDock } = await freshModule();
    setupMathKeyboardDock();

    expect(kb.container).toBe(dock);
    expect(dock.classList.contains("math-keyboard-dock--visible")).toBe(false);

    kb.visible = true;
    kb.fireToggle();
    expect(dock.classList.contains("math-keyboard-dock--visible")).toBe(true);

    kb.visible = false;
    kb.fireToggle();
    expect(dock.classList.contains("math-keyboard-dock--visible")).toBe(false);
  });

  it("only wires once per module load — a second call is a no-op even if the container changed", async () => {
    const kb = makeFakeKeyboard();
    (window as unknown as { mathVirtualKeyboard: unknown }).mathVirtualKeyboard = kb;
    const dock = document.createElement("div");
    dock.id = "math-keyboard-dock";
    document.body.appendChild(dock);

    const { setupMathKeyboardDock } = await freshModule();
    setupMathKeyboardDock();
    expect(kb.addEventListener).toHaveBeenCalledTimes(1);

    const otherDock = document.createElement("div");
    otherDock.id = "math-keyboard-dock-2";
    document.body.appendChild(otherDock);
    kb.container = null; // simulate something else touching it
    setupMathKeyboardDock();

    expect(kb.addEventListener).toHaveBeenCalledTimes(1); // still just the one wiring
    expect(kb.container).toBeNull(); // second call didn't re-set it
  });
});
