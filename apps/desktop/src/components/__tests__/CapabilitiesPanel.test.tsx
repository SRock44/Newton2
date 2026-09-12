import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import CapabilitiesPanel from "../CapabilitiesPanel";
import * as api from "../../api";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return { ...actual, listTools: vi.fn(), getGamificationStats: vi.fn() };
});

const listTools = api.listTools as ReturnType<typeof vi.fn>;
const getGamificationStats = api.getGamificationStats as ReturnType<typeof vi.fn>;

describe("CapabilitiesPanel", () => {
  beforeEach(() => {
    listTools.mockReset();
    listTools.mockResolvedValue([]);
    getGamificationStats.mockReset();
    getGamificationStats.mockResolvedValue({ streak_days: 0, xp: 0, level: 1, xp_to_next_level: 100 });
  });

  it("shows real connection/session/message context, not placeholder data", () => {
    listTools.mockResolvedValue([]);
    render(
      <CapabilitiesPanel token="tok" connectionStatus="open" sessionCount={3} messageCount={7} />,
    );

    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7 messages")).toBeInTheDocument();
  });

  it("fetches and lists the live tool belt from the backend", async () => {
    listTools.mockResolvedValue([
      { name: "calculator", description: "Evaluate exact arithmetic." },
      { name: "web_search", description: "Search the web." },
    ]);
    render(
      <CapabilitiesPanel token="tok" connectionStatus="open" sessionCount={0} messageCount={0} />,
    );

    expect(await screen.findByText("calculator")).toBeInTheDocument();
    expect(screen.getByText("Evaluate exact arithmetic.")).toBeInTheDocument();
    // tool names render with underscores replaced by spaces
    expect(screen.getByText("web search")).toBeInTheDocument();
  });

  it("shows a clear error if the tool list fails to load", async () => {
    listTools.mockRejectedValue(new Error("network error"));
    render(
      <CapabilitiesPanel token="tok" connectionStatus="closed" sessionCount={0} messageCount={0} />,
    );

    expect(await screen.findByText(/couldn't load newton's tools/i)).toBeInTheDocument();
  });

  it("shows streak, level, and XP once progress stats load", async () => {
    getGamificationStats.mockResolvedValue({ streak_days: 5, xp: 240, level: 3, xp_to_next_level: 60 });
    render(
      <CapabilitiesPanel token="tok" connectionStatus="open" sessionCount={0} messageCount={0} />,
    );

    expect(await screen.findByText("🔥 5")).toBeInTheDocument();
    expect(screen.getByText("Lv 3")).toBeInTheDocument();
    expect(screen.getByText("240 XP")).toBeInTheDocument();
    expect(screen.getByText("60 XP to level 4")).toBeInTheDocument();
  });

  it("shows a plain 0 (no fire emoji) with no active streak", async () => {
    getGamificationStats.mockResolvedValue({ streak_days: 0, xp: 0, level: 1, xp_to_next_level: 100 });
    // sessionCount/messageCount deliberately non-zero so they can't collide with the
    // streak value's own "0" text when queried below.
    render(
      <CapabilitiesPanel token="tok" connectionStatus="open" sessionCount={2} messageCount={4} />,
    );

    await screen.findByText("Lv 1");
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText(/🔥/)).not.toBeInTheDocument();
  });

  it("silently omits the progress section if stats fail to load", async () => {
    getGamificationStats.mockRejectedValue(new Error("network error"));
    render(
      <CapabilitiesPanel token="tok" connectionStatus="open" sessionCount={0} messageCount={0} />,
    );

    await screen.findByText("connected");
    expect(screen.queryByText(/day streak/i)).not.toBeInTheDocument();
  });
});
