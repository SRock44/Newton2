import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ContextPanel from "../ContextPanel";
import * as api from "../../api";
import {
  CONTEXT_PANEL_DEFAULT_WIDTH,
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  getContextPanelWidth,
} from "../../lib/preferences";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return { ...actual, getGamificationStats: vi.fn() };
});

const getGamificationStats = api.getGamificationStats as ReturnType<typeof vi.fn>;

describe("ContextPanel", () => {
  beforeEach(() => {
    getGamificationStats.mockReset();
    getGamificationStats.mockResolvedValue({ streak_days: 0, xp: 0, level: 1, xp_to_next_level: 100 });
    window.localStorage.clear();
  });

  it("shows real session/message context, not placeholder data", () => {
    render(<ContextPanel token="tok" sessionCount={3} messageCount={7} mainView="chat" />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7 messages")).toBeInTheDocument();
  });

  it("shows streak, level, and XP once progress stats load", async () => {
    getGamificationStats.mockResolvedValue({ streak_days: 5, xp: 240, level: 3, xp_to_next_level: 60 });
    render(<ContextPanel token="tok" sessionCount={0} messageCount={0} mainView="chat" />);

    expect(await screen.findByText("🔥 5")).toBeInTheDocument();
    expect(screen.getByText("Lv 3")).toBeInTheDocument();
    expect(screen.getByText("240 XP")).toBeInTheDocument();
    expect(screen.getByText("60 XP to level 4")).toBeInTheDocument();
  });

  it("shows a plain 0 (no fire emoji) with no active streak", async () => {
    getGamificationStats.mockResolvedValue({ streak_days: 0, xp: 0, level: 1, xp_to_next_level: 100 });
    // sessionCount/messageCount deliberately non-zero so they can't collide with the
    // streak value's own "0" text when queried below.
    render(<ContextPanel token="tok" sessionCount={2} messageCount={4} mainView="chat" />);

    await screen.findByText("Lv 1");
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText(/🔥/)).not.toBeInTheDocument();
  });

  it("silently omits the progress section if stats fail to load", async () => {
    getGamificationStats.mockRejectedValue(new Error("network error"));
    render(<ContextPanel token="tok" sessionCount={0} messageCount={0} mainView="chat" />);

    await screen.findByText("0"); // sessionCount rendered, panel is up
    expect(screen.queryByText(/day streak/i)).not.toBeInTheDocument();
  });

  it("does not show a capabilities/tool list — that's HelpModal's job now", async () => {
    render(<ContextPanel token="tok" sessionCount={0} messageCount={0} mainView="chat" />);
    expect(screen.queryByText("What Newton can do")).not.toBeInTheDocument();
  });

  it("shows a formatted token total when usage is available", () => {
    render(<ContextPanel token="tok" sessionCount={1} messageCount={2} totalTokens={12345} mainView="chat" />);
    expect(screen.getByText("Tokens used")).toBeInTheDocument();
    expect(screen.getByText("12,345")).toBeInTheDocument();
  });

  it("hides the token row entirely when no usage is available (0, or omitted)", () => {
    render(<ContextPanel token="tok" sessionCount={1} messageCount={2} mainView="chat" />);
    expect(screen.queryByText("Tokens used")).not.toBeInTheDocument();
  });

  it("hides 'This conversation' and 'Tokens used' once you've navigated away from chat, even though the last-open session's counts are still passed in", () => {
    render(<ContextPanel token="tok" sessionCount={4} messageCount={9} totalTokens={500} mainView="home" />);

    expect(screen.getByText("4")).toBeInTheDocument(); // total chat count still shown
    expect(screen.queryByText("This conversation")).not.toBeInTheDocument();
    expect(screen.queryByText("9 messages")).not.toBeInTheDocument();
    expect(screen.queryByText("Tokens used")).not.toBeInTheDocument();
  });

  it("collapses to a slim rail and back, same pattern as the sidebar", () => {
    const { container } = render(
      <ContextPanel token="tok" sessionCount={3} messageCount={7} mainView="chat" />,
    );
    expect(container.querySelector(".right-panel--collapsed")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Newton context" }));
    expect(container.querySelector(".right-panel--collapsed")).toBeInTheDocument();
    expect(screen.queryByText("Newton context")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Newton context" }));
    expect(container.querySelector(".right-panel--collapsed")).not.toBeInTheDocument();
    expect(screen.getByText("Newton context")).toBeInTheDocument();
  });

  it("remembers the collapsed state across remounts", () => {
    const first = render(<ContextPanel token="tok" sessionCount={3} messageCount={7} mainView="chat" />);
    fireEvent.click(first.getByRole("button", { name: "Collapse Newton context" }));
    first.unmount();

    const second = render(<ContextPanel token="tok" sessionCount={3} messageCount={7} mainView="chat" />);
    expect(second.container.querySelector(".right-panel--collapsed")).toBeInTheDocument();
  });

  describe("drag-to-resize", () => {
    function panelWidthVar(container: HTMLElement): string | undefined {
      const el = container.querySelector(".right-panel") as HTMLElement | null;
      return el?.style.getPropertyValue("--context-panel-width");
    }

    function drag(handle: HTMLElement, fromX: number, toX: number) {
      fireEvent.mouseDown(handle, { button: 0, clientX: fromX });
      fireEvent.mouseMove(window, { clientX: toX });
      fireEvent.mouseUp(window, { clientX: toX });
    }

    it("renders a resize handle, seeded at the shipped default width", () => {
      const { container } = render(<ContextPanel token="tok" sessionCount={1} messageCount={1} mainView="chat" />);

      expect(screen.getByRole("separator", { name: "Resize Newton context" })).toBeInTheDocument();
      expect(panelWidthVar(container)).toBe(`${CONTEXT_PANEL_DEFAULT_WIDTH}px`);
    });

    it("is MIRRORED from the sidebar: dragging LEFT widens this panel, because it lives on the right edge", () => {
      const { container } = render(<ContextPanel token="tok" sessionCount={1} messageCount={1} mainView="chat" />);
      drag(screen.getByRole("separator", { name: "Resize Newton context" }), 800, 760);

      expect(panelWidthVar(container)).toBe(`${CONTEXT_PANEL_DEFAULT_WIDTH + 40}px`);
    });

    it("dragging right narrows it", () => {
      const { container } = render(<ContextPanel token="tok" sessionCount={1} messageCount={1} mainView="chat" />);
      drag(screen.getByRole("separator", { name: "Resize Newton context" }), 800, 820);

      expect(panelWidthVar(container)).toBe(`${CONTEXT_PANEL_DEFAULT_WIDTH - 20}px`);
    });

    it("clamps to its own min/max", () => {
      const { container } = render(<ContextPanel token="tok" sessionCount={1} messageCount={1} mainView="chat" />);
      const handle = screen.getByRole("separator", { name: "Resize Newton context" });

      drag(handle, 800, 2000);
      expect(panelWidthVar(container)).toBe(`${CONTEXT_PANEL_MIN_WIDTH}px`);

      drag(handle, 800, 0);
      expect(panelWidthVar(container)).toBe(`${CONTEXT_PANEL_MAX_WIDTH}px`);
    });

    it("persists on mouseup and restores on remount, under its own storage key", () => {
      const first = render(<ContextPanel token="tok" sessionCount={1} messageCount={1} mainView="chat" />);
      drag(screen.getByRole("separator", { name: "Resize Newton context" }), 800, 750);

      expect(getContextPanelWidth()).toBe(CONTEXT_PANEL_DEFAULT_WIDTH + 50);
      first.unmount();

      const second = render(<ContextPanel token="tok" sessionCount={1} messageCount={1} mainView="chat" />);
      expect(panelWidthVar(second.container)).toBe(`${CONTEXT_PANEL_DEFAULT_WIDTH + 50}px`);
    });

    it("hides the handle while collapsed", () => {
      render(<ContextPanel token="tok" sessionCount={1} messageCount={1} mainView="chat" />);
      fireEvent.click(screen.getByRole("button", { name: "Collapse Newton context" }));

      expect(screen.queryByRole("separator", { name: "Resize Newton context" })).not.toBeInTheDocument();
    });
  });
});
