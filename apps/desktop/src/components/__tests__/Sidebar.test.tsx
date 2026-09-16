import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "../Sidebar";
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, getSidebarWidth } from "../../lib/preferences";
import type { ChatSession, MainView } from "../../types";

const SESSIONS: ChatSession[] = [
  { id: "s1", title: "Physics review", status: "active", created_at: "2026-01-01T00:00:00Z" },
];

function baseProps(mainView: MainView = "home") {
  return {
    sessions: SESSIONS,
    activeSessionId: "s1",
    firstMessageBySession: {},
    onSelectSession: vi.fn(),
    onNewChat: vi.fn(),
    onDeleteSession: vi.fn(),
    creatingChat: false,
    username: "student1",
    onSignOut: vi.fn(),
    onOpenHome: vi.fn(),
    onOpenDocuments: vi.fn(),
    onOpenStudyPlan: vi.fn(),
    onOpenCalendar: vi.fn(),
    onOpenFlashcards: vi.fn(),
    onOpenPracticeExams: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenHelp: vi.fn(),
    mainView,
  };
}

describe("Sidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders expanded by default, with the full session list and nav labels", () => {
    render(<Sidebar {...baseProps()} />);

    expect(screen.getByText("Physics review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });

  it("collapses to a slim icon-only rail when the collapse toggle is clicked, hiding the session list", async () => {
    const user = userEvent.setup();
    render(<Sidebar {...baseProps()} />);

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.queryByText("Physics review")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    // Still icon-reachable while collapsed — a rail button for each nav destination.
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Documents" })).toBeInTheDocument();
  });

  it("expanding again restores the full session list", async () => {
    const user = userEvent.setup();
    render(<Sidebar {...baseProps()} />);

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(screen.getByText("Physics review")).toBeInTheDocument();
  });

  it("persists the collapsed state across a remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Sidebar {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    unmount();

    render(<Sidebar {...baseProps()} />);
    expect(screen.queryByText("Physics review")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("clicking Home calls the existing onOpenHome callback", async () => {
    const user = userEvent.setup();
    const onOpenHome = vi.fn();
    render(<Sidebar {...baseProps("documents")} onOpenHome={onOpenHome} />);

    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(onOpenHome).toHaveBeenCalledTimes(1);
  });

  it("selecting a session still calls onSelectSession, unaffected by the collapse feature", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    render(<Sidebar {...baseProps()} onSelectSession={onSelectSession} />);

    await user.click(screen.getByText("Physics review"));
    expect(onSelectSession).toHaveBeenCalledWith("s1");
  });

  describe("drag-to-resize", () => {
    /** Reads the CSS custom property the sidebar publishes its width through — the
     * inline `style` attribute is the real contract with App.css's
     * `width: var(--sidebar-width, …)`, so that's what these assert on. */
    function sidebarWidthVar(container: HTMLElement): string | undefined {
      const el = container.querySelector(".sidebar") as HTMLElement | null;
      return el?.style.getPropertyValue("--sidebar-width");
    }

    function drag(handle: HTMLElement, fromX: number, toX: number) {
      fireEvent.mouseDown(handle, { button: 0, clientX: fromX });
      fireEvent.mouseMove(window, { clientX: toX });
      fireEvent.mouseUp(window, { clientX: toX });
    }

    it("renders a resize handle on the expanded sidebar, seeded at the shipped default width", () => {
      const { container } = render(<Sidebar {...baseProps()} />);

      expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeInTheDocument();
      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
    });

    it("dragging the handle right widens the sidebar live", () => {
      const { container } = render(<Sidebar {...baseProps()} />);
      const handle = screen.getByRole("separator", { name: "Resize sidebar" });

      fireEvent.mouseDown(handle, { button: 0, clientX: 236 });
      fireEvent.mouseMove(window, { clientX: 296 });

      // Live, mid-drag — before mouseup.
      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH + 60}px`);
    });

    it("dragging the handle left narrows the sidebar", () => {
      const { container } = render(<Sidebar {...baseProps()} />);
      drag(screen.getByRole("separator", { name: "Resize sidebar" }), 236, 206);

      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH - 30}px`);
    });

    it("clamps to the min and max regardless of how far the pointer travels", () => {
      const { container } = render(<Sidebar {...baseProps()} />);
      const handle = screen.getByRole("separator", { name: "Resize sidebar" });

      drag(handle, 236, -900);
      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_MIN_WIDTH}px`);

      drag(handle, 236, 3000);
      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_MAX_WIDTH}px`);
    });

    it("persists the width only on mouseup, and restores it on a remount", () => {
      const first = render(<Sidebar {...baseProps()} />);
      const handle = screen.getByRole("separator", { name: "Resize sidebar" });

      fireEvent.mouseDown(handle, { button: 0, clientX: 236 });
      fireEvent.mouseMove(window, { clientX: 316 });
      // Mid-drag: nothing written yet — a drag shouldn't mean one write per pixel.
      expect(getSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);

      fireEvent.mouseUp(window, { clientX: 316 });
      expect(getSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH + 80);

      first.unmount();
      const second = render(<Sidebar {...baseProps()} />);
      expect(sidebarWidthVar(second.container)).toBe(`${SIDEBAR_DEFAULT_WIDTH + 80}px`);
    });

    it("stops tracking the pointer after mouseup", () => {
      const { container } = render(<Sidebar {...baseProps()} />);
      const handle = screen.getByRole("separator", { name: "Resize sidebar" });

      drag(handle, 236, 286);
      fireEvent.mouseMove(window, { clientX: 400 });

      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH + 50}px`);
    });

    it("ignores a non-primary mouse button, so a right-click can't start a phantom drag", () => {
      const { container } = render(<Sidebar {...baseProps()} />);
      const handle = screen.getByRole("separator", { name: "Resize sidebar" });

      fireEvent.mouseDown(handle, { button: 2, clientX: 236 });
      fireEvent.mouseMove(window, { clientX: 400 });

      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
    });

    it("is keyboard-operable: arrows nudge the width and Home restores the default", () => {
      const { container } = render(<Sidebar {...baseProps()} />);
      const handle = screen.getByRole("separator", { name: "Resize sidebar" });

      fireEvent.keyDown(handle, { key: "ArrowRight" });
      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH + 8}px`);

      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);

      fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH + 32}px`);
      // Unlike a drag, a keypress is a discrete commit and persists immediately.
      expect(getSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH + 32);

      fireEvent.keyDown(handle, { key: "Home" });
      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
    });

    it("hides the handle while collapsed — a fixed icon rail has no width to drag", async () => {
      const user = userEvent.setup();
      render(<Sidebar {...baseProps()} />);

      await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

      expect(screen.queryByRole("separator", { name: "Resize sidebar" })).not.toBeInTheDocument();
    });

    it("keeps a custom width through a collapse/expand round trip", async () => {
      const user = userEvent.setup();
      const { container } = render(<Sidebar {...baseProps()} />);
      drag(screen.getByRole("separator", { name: "Resize sidebar" }), 236, 336);

      await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
      await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

      expect(sidebarWidthVar(container)).toBe(`${SIDEBAR_DEFAULT_WIDTH + 100}px`);
    });
  });
});
