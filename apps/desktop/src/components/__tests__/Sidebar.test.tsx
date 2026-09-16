import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "../Sidebar";
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
});
