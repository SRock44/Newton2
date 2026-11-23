import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "../Sidebar";
import ContextPanel from "../ContextPanel";
import type { SidebarProps } from "../Sidebar";
import * as api from "../../api";
import {
  getSidebarCollapsed, getSidebarWidth, setSidebarCollapsed,
  getContextPanelCollapsed, setContextPanelCollapsed,
} from "../../lib/preferences";

vi.mock("../../lib/webSidebars", () => ({ webSidebarsEnabled: () => true }));
vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return { ...actual, getGamificationStats: vi.fn() };
});

const stats = vi.mocked(api.getGamificationStats);

function sidebarProps(): SidebarProps {
  return {
    sessions: [{ id: "s1", title: "Physics review", status: "active", created_at: "2026-11-01T12:00:00Z" }],
    activeSessionId: "s1", firstMessageBySession: {}, creatingChat: false, username: "student",
    mainView: "home", onSelectSession: vi.fn(), onNewChat: vi.fn(), onDeleteSession: vi.fn(), onSignOut: vi.fn(),
    onOpenHome: vi.fn(), onOpenDocuments: vi.fn(), onOpenStudyPlan: vi.fn(), onOpenCalendar: vi.fn(),
    onOpenFlashcards: vi.fn(), onOpenPracticeExams: vi.fn(), onOpenSettings: vi.fn(), onOpenHelp: vi.fn(),
  };
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe("web sidebar interactions", () => {
  beforeEach(() => {
    localStorage.clear();
    setSidebarCollapsed(true);
    setContextPanelCollapsed(true);
    stats.mockReset().mockResolvedValue({
      streak_days: 1, xp: 14, level: 1, xp_to_next_level: 86,
      messages_sent: 0, flashcards_reviewed: 0, flashcards_created: 0, study_plan_items: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("previews on hover without pinning, tolerates re-entry, and cancels pass-through hovers", () => {
    vi.useFakeTimers();
    render(<Sidebar {...sidebarProps()} />);
    const sidebar = screen.getByRole("complementary", { name: "Navigation sidebar" });
    expect(screen.queryByRole("navigation", { name: "Chat sessions" })).not.toBeInTheDocument();
    fireEvent.pointerEnter(sidebar, { pointerType: "mouse" });
    advance(99);
    expect(sidebar).toHaveAttribute("data-open", "false");
    advance(1);
    expect(screen.getByRole("navigation", { name: "Chat sessions" })).toBeInTheDocument();
    expect(sidebar).toHaveAttribute("data-pinned", "false");
    expect(getSidebarCollapsed()).toBe(true);
    fireEvent.pointerLeave(sidebar);
    advance(100);
    fireEvent.pointerEnter(sidebar, { pointerType: "mouse" });
    advance(100);
    expect(sidebar).toHaveAttribute("data-open", "true");
    fireEvent.pointerLeave(sidebar);
    advance(180);
    expect(sidebar).toHaveAttribute("data-open", "false");
    fireEvent.pointerEnter(sidebar, { pointerType: "mouse" });
    advance(20);
    fireEvent.pointerLeave(sidebar);
    advance(300);
    expect(sidebar).toHaveAttribute("data-open", "false");
  });

  it("pins both sides independently, preserves their layout mode on pointer exit, and restores it on remount", () => {
    vi.useFakeTimers();
    const props = sidebarProps();
    const view = render(<div className="app-shell"><Sidebar {...props} /><main>Page content</main><ContextPanel token="tok" sessionCount={4} messageCount={0} mainView="home" /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Pin sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin Newton context" }));
    const left = screen.getByRole("complementary", { name: "Navigation sidebar" });
    const right = screen.getByRole("complementary", { name: "Newton context" });
    expect(left).toHaveAttribute("data-pinned", "true");
    expect(right).toHaveAttribute("data-pinned", "true");
    expect(getSidebarCollapsed()).toBe(false);
    expect(getContextPanelCollapsed()).toBe(false);
    fireEvent.pointerLeave(left);
    fireEvent.pointerLeave(right);
    advance(500);
    expect(left).toHaveAttribute("data-open", "true");
    expect(right).toHaveAttribute("data-open", "true");
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Unpin sidebar" }));
    expect(left).toHaveAttribute("data-pinned", "false");
    expect(right).toHaveAttribute("data-pinned", "true");
    expect(screen.getByRole("button", { name: "Pin sidebar" })).toHaveFocus();
    view.unmount();
    render(<><Sidebar {...props} /><ContextPanel token="tok" sessionCount={4} messageCount={0} mainView="home" /></>);
    expect(screen.getByRole("complementary", { name: "Navigation sidebar" })).toHaveAttribute("data-pinned", "false");
    expect(screen.getByRole("complementary", { name: "Newton context" })).toHaveAttribute("data-pinned", "true");
  });

  it("opens for keyboard navigation, keeps focused controls available, and returns focus on Escape", () => {
    vi.useFakeTimers();
    render(<><button>Outside</button><Sidebar {...sidebarProps()} /></>);
    act(() => { screen.getByRole("button", { name: "Documents" }).focus(); });
    const sidebar = screen.getByRole("complementary", { name: "Navigation sidebar" });
    const documents = screen.getByRole("button", { name: "Documents" });
    expect(documents.closest(".web-sidebar-panel")).not.toBeNull();
    expect(documents).toHaveFocus();
    fireEvent.pointerLeave(sidebar);
    advance(200);
    expect(sidebar).toHaveAttribute("data-open", "true");
    fireEvent.keyDown(documents, { key: "Escape" });
    expect(sidebar).toHaveAttribute("data-open", "false");
    expect(screen.getByRole("button", { name: "Pin sidebar" })).toHaveFocus();
    act(() => { screen.getByRole("button", { name: "Documents" }).focus(); });
    act(() => { screen.getByRole("button", { name: "Outside" }).focus(); });
    advance(180);
    expect(sidebar).toHaveAttribute("data-open", "false");
  });

  it("keeps navigation, session selection/deletion, and resize persistence wired to the real actions", () => {
    setSidebarCollapsed(false);
    const props = sidebarProps();
    render(<Sidebar {...props} />);
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    fireEvent.click(within(navigation).getByRole("button", { name: "Documents" }));
    fireEvent.click(within(navigation).getByRole("button", { name: "New chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByText("Physics review"));
    fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));
    expect(props.onOpenDocuments).toHaveBeenCalledOnce();
    expect(props.onNewChat).toHaveBeenCalledOnce();
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
    expect(props.onSelectSession).toHaveBeenCalledWith("s1");
    expect(props.onDeleteSession).toHaveBeenCalledWith("s1");
    const width = getSidebarWidth();
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize sidebar" }), { key: "ArrowRight" });
    expect(getSidebarWidth()).toBe(width + 8);
  });

  it.each([true, false])("keeps every navigation action working with collapsed=%s", (collapsed) => {
    setSidebarCollapsed(collapsed);
    const props = sidebarProps();
    render(<Sidebar {...props} />);
    const actions = [
      ["Home", props.onOpenHome], ["New chat", props.onNewChat], ["Documents", props.onOpenDocuments],
      ["Study plan", props.onOpenStudyPlan], ["Calendar", props.onOpenCalendar],
      ["Flashcards", props.onOpenFlashcards], ["Practice exams", props.onOpenPracticeExams],
      ["Settings", props.onOpenSettings], ["What Newton can do", props.onOpenHelp], ["Sign out", props.onSignOut],
    ] as const;
    for (const [name, callback] of actions) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(callback).toHaveBeenCalledOnce();
    }
  });

  it.each([true, false])("blocks duplicate chat creation with collapsed=%s", (collapsed) => {
    setSidebarCollapsed(collapsed);
    const props = sidebarProps();
    const view = render(<Sidebar {...props} creatingChat />);
    const newChat = screen.getByRole("button", { name: collapsed ? "New chat" : "Starting…" });
    expect(newChat).toBeDisabled();
    fireEvent.click(newChat);
    expect(props.onNewChat).not.toHaveBeenCalled();
    view.rerender(<Sidebar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(props.onNewChat).toHaveBeenCalledOnce();
  });

  it("cancels pending preview timers when removed", () => {
    vi.useFakeTimers();
    const view = render(<Sidebar {...sidebarProps()} />);
    fireEvent.pointerEnter(screen.getByRole("complementary", { name: "Navigation sidebar" }));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replace rail controls during a touch press or mouse click", () => {
    vi.useFakeTimers();
    const props = sidebarProps();
    render(<Sidebar {...props} />);
    const sidebar = screen.getByRole("complementary", { name: "Navigation sidebar" });
    const documents = screen.getByRole("button", { name: "Documents" });
    const pointer = (type: string, pointerType: string) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "pointerType", { value: pointerType });
      fireEvent(documents, event);
    };
    fireEvent.pointerEnter(sidebar, { pointerType: "mouse" });
    pointer("pointerdown", "mouse");
    act(() => documents.focus());
    advance(200);
    expect(sidebar).toHaveAttribute("data-open", "false");
    pointer("pointerup", "mouse");
    fireEvent.click(documents);
    expect(props.onOpenDocuments).toHaveBeenCalledOnce();
    expect(sidebar).toHaveAttribute("data-open", "false");
    pointer("pointerdown", "touch");
    act(() => documents.focus());
    pointer("pointerup", "touch");
    fireEvent.click(documents);
    advance(200);
    expect(props.onOpenDocuments).toHaveBeenCalledTimes(2);
    expect(sidebar).toHaveAttribute("data-open", "false");
  });

  it("keeps the original live right-panel data and conversation-specific rows", async () => {
    setContextPanelCollapsed(false);
    const view = render(<ContextPanel token="tok" sessionCount={4} messageCount={7} totalTokens={12345} mainView="home" />);
    expect(await screen.findByText("14 XP")).toBeInTheDocument();
    expect(screen.getByText("🔥 1")).toBeInTheDocument();
    expect(screen.getByText("Lv 1")).toBeInTheDocument();
    expect(screen.getByText("86 XP to level 2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "14");
    expect(screen.queryByText("This conversation")).not.toBeInTheDocument();
    view.rerender(<ContextPanel token="tok" sessionCount={4} messageCount={7} totalTokens={12345} mainView="chat" />);
    expect(screen.getByText("7 messages")).toBeInTheDocument();
    expect(screen.getByText("12,345")).toBeInTheDocument();
    await waitFor(() => expect(stats).toHaveBeenCalledTimes(2));
  });

  it("retains counts without substituting sample progress when the API fails", async () => {
    stats.mockRejectedValue(new Error("offline"));
    setContextPanelCollapsed(false);
    render(<ContextPanel token="tok" sessionCount={4} messageCount={7} mainView="home" />);
    await waitFor(() => expect(stats).toHaveBeenCalledOnce());
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
