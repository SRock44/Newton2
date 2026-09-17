import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TitleBar from "../TitleBar";

// Mirrors the mocked-event-bridge pattern used for the tray icon / notepad-sync
// features (see App.test.tsx and NotepadWindow.test.tsx): there's no real Tauri IPC
// bridge under jsdom, so `getCurrentWindow()` is mocked to a fake window object and
// every assertion checks that TitleBar calls the *real* window API methods rather than
// faking the effect some other way.
const minimize = vi.fn(async () => {});
const toggleMaximize = vi.fn(async () => {});
const close = vi.fn(async () => {});
const isMaximized = vi.fn(async () => false);
let resizedCallback: (() => void) | undefined;
const onResized = vi.fn(async (cb: () => void) => {
  resizedCallback = cb;
  return () => {
    resizedCallback = undefined;
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize, toggleMaximize, close, isMaximized, onResized }),
}));

describe("TitleBar", () => {
  beforeEach(() => {
    minimize.mockClear();
    toggleMaximize.mockClear();
    close.mockClear();
    isMaximized.mockReset();
    isMaximized.mockResolvedValue(false);
    onResized.mockClear();
    resizedCallback = undefined;
  });

  it("renders minimize, maximize, and close controls for the main window", async () => {
    render(<TitleBar title="Newton" />);
    await waitFor(() => expect(isMaximized).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  // The Notepad window is a small, fixed-purpose utility window — minimize + close
  // only, no maximize control, but still the same custom-chrome treatment.
  it("omits the maximize control for the notepad window, keeping minimize and close", () => {
    render(<TitleBar title="Newton Notepad" variant="notepad" />);
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /maximize|restore/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    // A notepad-variant bar never even asks the window whether it's maximized.
    expect(isMaximized).not.toHaveBeenCalled();
  });

  it("calls the real Tauri window API when each control is clicked", async () => {
    const user = userEvent.setup();
    render(<TitleBar title="Newton" />);
    await waitFor(() => expect(isMaximized).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await waitFor(() => expect(minimize).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Maximize" }));
    await waitFor(() => expect(toggleMaximize).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  // Regression coverage for the maximize/restore icon actually reflecting real window
  // state (not just optimistically flipping on click) — it must also pick up a
  // maximize/restore that happened some other way (OS snap, double-clicking the drag
  // region), which is exactly what the onResized subscription is for.
  it("swaps the maximize icon for restore once the window reports maximized via a resize event", async () => {
    render(<TitleBar title="Newton" />);
    await waitFor(() => expect(isMaximized).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();

    isMaximized.mockResolvedValue(true);
    await waitFor(() => expect(resizedCallback).toBeDefined());
    await act(async () => {
      resizedCallback?.();
      await Promise.resolve();
    });

    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Maximize" })).not.toBeInTheDocument();
  });

  // The whole bar is draggable (and double-click-to-maximize, which Tauri handles for
  // any data-tauri-drag-region element automatically) — not just the narrow brand/title
  // area — so a real user can grab it from anywhere along the top, matching a normal OS
  // title bar. The one invariant that must still hold: no *button itself* ever carries
  // the attribute, since Tauri matches the exact element under the pointer, not any
  // ancestor — a button without the attribute stays independently clickable even though
  // its container (correctly) has it.
  it("marks the whole bar as a drag region, but never a control button itself", async () => {
    const { container } = render(<TitleBar title="Newton" />);
    await waitFor(() => expect(isMaximized).toHaveBeenCalled());
    const dragRegions = container.querySelectorAll("[data-tauri-drag-region]");
    expect(dragRegions.length).toBeGreaterThan(0);
    dragRegions.forEach((el) => {
      expect(el.tagName.toLowerCase()).not.toBe("button");
    });

    const outerBar = container.querySelector(".titlebar");
    expect(outerBar).toHaveAttribute("data-tauri-drag-region");

    screen.getAllByRole("button").forEach((button) => {
      expect(button).not.toHaveAttribute("data-tauri-drag-region");
    });
  });
});

// Same component, but rendered as if under Tauri's WKWebView on macOS -- mocks
// navigator.platform the way isMacPlatform() (src/lib/platform.ts) reads it, since
// jsdom's real default ("") always exercises the Windows-style branch above regardless
// of the host OS actually running the test.
describe("TitleBar (macOS)", () => {
  beforeEach(() => {
    minimize.mockClear();
    toggleMaximize.mockClear();
    close.mockClear();
    isMaximized.mockReset();
    isMaximized.mockResolvedValue(false);
    onResized.mockClear();
    resizedCallback = undefined;
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders close/minimize/zoom traffic lights, in that order, instead of a right-aligned cluster", async () => {
    render(<TitleBar title="Newton" />);
    await waitFor(() => expect(isMaximized).toHaveBeenCalled());

    const lights = screen
      .getAllByRole("button")
      .filter((btn) => btn.className.includes("traffic-light"));
    expect(lights.map((btn) => btn.getAttribute("aria-label"))).toEqual(["Close", "Minimize", "Maximize"]);
    expect(document.querySelector(".titlebar-btn")).not.toBeInTheDocument();
  });

  it("omits the zoom control for the notepad window, keeping close and minimize", () => {
    render(<TitleBar title="Newton Notepad" variant="notepad" />);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /maximize|restore/i })).not.toBeInTheDocument();
    expect(isMaximized).not.toHaveBeenCalled();
  });

  it("calls the real Tauri window API when each traffic light is clicked", async () => {
    const user = userEvent.setup();
    render(<TitleBar title="Newton" />);
    await waitFor(() => expect(isMaximized).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await waitFor(() => expect(minimize).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Maximize" }));
    await waitFor(() => expect(toggleMaximize).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it("centers the title/brand group instead of anchoring it next to a right-aligned control cluster", async () => {
    const { container } = render(<TitleBar title="Newton" />);
    await waitFor(() => expect(isMaximized).toHaveBeenCalled());
    expect(container.querySelector(".titlebar-brand--center")).toBeInTheDocument();
  });
});
