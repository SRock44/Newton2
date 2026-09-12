import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import CapabilitiesPanel from "../CapabilitiesPanel";
import * as api from "../../api";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return { ...actual, listTools: vi.fn() };
});

const listTools = api.listTools as ReturnType<typeof vi.fn>;

describe("CapabilitiesPanel", () => {
  beforeEach(() => {
    listTools.mockReset();
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
});
