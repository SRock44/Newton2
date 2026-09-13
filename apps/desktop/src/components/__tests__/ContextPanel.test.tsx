import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ContextPanel from "../ContextPanel";
import * as api from "../../api";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return { ...actual, getGamificationStats: vi.fn() };
});

const getGamificationStats = api.getGamificationStats as ReturnType<typeof vi.fn>;

describe("ContextPanel", () => {
  beforeEach(() => {
    getGamificationStats.mockReset();
    getGamificationStats.mockResolvedValue({ streak_days: 0, xp: 0, level: 1, xp_to_next_level: 100 });
  });

  it("shows real session/message context, not placeholder data", () => {
    render(<ContextPanel token="tok" sessionCount={3} messageCount={7} />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7 messages")).toBeInTheDocument();
  });

  it("shows streak, level, and XP once progress stats load", async () => {
    getGamificationStats.mockResolvedValue({ streak_days: 5, xp: 240, level: 3, xp_to_next_level: 60 });
    render(<ContextPanel token="tok" sessionCount={0} messageCount={0} />);

    expect(await screen.findByText("🔥 5")).toBeInTheDocument();
    expect(screen.getByText("Lv 3")).toBeInTheDocument();
    expect(screen.getByText("240 XP")).toBeInTheDocument();
    expect(screen.getByText("60 XP to level 4")).toBeInTheDocument();
  });

  it("shows a plain 0 (no fire emoji) with no active streak", async () => {
    getGamificationStats.mockResolvedValue({ streak_days: 0, xp: 0, level: 1, xp_to_next_level: 100 });
    // sessionCount/messageCount deliberately non-zero so they can't collide with the
    // streak value's own "0" text when queried below.
    render(<ContextPanel token="tok" sessionCount={2} messageCount={4} />);

    await screen.findByText("Lv 1");
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText(/🔥/)).not.toBeInTheDocument();
  });

  it("silently omits the progress section if stats fail to load", async () => {
    getGamificationStats.mockRejectedValue(new Error("network error"));
    render(<ContextPanel token="tok" sessionCount={0} messageCount={0} />);

    await screen.findByText("0"); // sessionCount rendered, panel is up
    expect(screen.queryByText(/day streak/i)).not.toBeInTheDocument();
  });

  it("does not show a capabilities/tool list — that's HelpModal's job now", async () => {
    render(<ContextPanel token="tok" sessionCount={0} messageCount={0} />);
    expect(screen.queryByText("What Newton can do")).not.toBeInTheDocument();
  });

  it("shows a formatted token total when usage is available", () => {
    render(<ContextPanel token="tok" sessionCount={1} messageCount={2} totalTokens={12345} />);
    expect(screen.getByText("Tokens used")).toBeInTheDocument();
    expect(screen.getByText("12,345")).toBeInTheDocument();
  });

  it("hides the token row entirely when no usage is available (0, or omitted)", () => {
    render(<ContextPanel token="tok" sessionCount={1} messageCount={2} />);
    expect(screen.queryByText("Tokens used")).not.toBeInTheDocument();
  });
});
