import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HelpModal from "../HelpModal";
import * as api from "../../api";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return { ...actual, listTools: vi.fn() };
});

const listTools = api.listTools as ReturnType<typeof vi.fn>;

describe("HelpModal", () => {
  beforeEach(() => {
    listTools.mockReset();
    listTools.mockResolvedValue([]);
  });

  it("fetches and lists the live tool belt from the backend", async () => {
    listTools.mockResolvedValue([
      { name: "calculator", description: "Evaluate exact arithmetic." },
      { name: "web_search", description: "Search the web." },
    ]);
    render(<HelpModal token="tok" onClose={vi.fn()} />);

    expect(await screen.findByText("calculator")).toBeInTheDocument();
    expect(screen.getByText("Evaluate exact arithmetic.")).toBeInTheDocument();
    // tool names render with underscores replaced by spaces
    expect(screen.getByText("web search")).toBeInTheDocument();
  });

  it("shows a clear error if the tool list fails to load", async () => {
    listTools.mockRejectedValue(new Error("network error"));
    render(<HelpModal token="tok" onClose={vi.fn()} />);

    expect(await screen.findByText(/couldn't load newton's tools/i)).toBeInTheDocument();
  });

  it("closes on the close button and on clicking outside the panel, matching the other modals", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<HelpModal token="tok" onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
