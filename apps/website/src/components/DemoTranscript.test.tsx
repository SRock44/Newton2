import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DemoTranscript from "./DemoTranscript";
import demoTranscriptsData from "@/data/demo-transcripts.json";
import type { DemoScenario } from "@/lib/demoTranscript";

const scenarios = demoTranscriptsData as DemoScenario[];

/** Stubs `window.matchMedia("(prefers-reduced-motion: reduce)")` so the component takes
 * its documented reduced-motion branch: jump straight to a scenario's final state
 * instead of stepping through real timers. Used for the tests that only care about
 * "what ends up on screen", not the pacing of getting there. */
function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("DemoTranscript", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error -- test-only cleanup of the stub installed above
    delete window.matchMedia;
  });

  it("renders a tab for each real scenario and starts idle (no autoplay without a real IntersectionObserver)", () => {
    mockReducedMotion(false);
    render(<DemoTranscript />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.textContent)).toEqual(scenarios.map((s) => s.label));
    expect(screen.getByText(/scroll down, or pick a scenario/i)).toBeInTheDocument();
  });

  it("switching scenarios plays the newly selected one's real transcript (reduced motion: jumps to its final state)", async () => {
    mockReducedMotion(true);
    const user = userEvent.setup();
    render(<DemoTranscript />);

    const chemistryTab = screen.getByRole("tab", { name: "Balances a real equation" });
    await act(async () => {
      await user.click(chemistryTab);
    });

    expect(chemistryTab).toHaveAttribute("aria-selected", "true");
    // The real user_message for chemistry-balance:
    expect(
      screen.getByText(/what are the correct balanced coefficients for c3h8/i)
    ).toBeInTheDocument();
    // The real, fully-streamed reply text for this scenario:
    expect(screen.getByText(/everything balances/i)).toBeInTheDocument();

    const codeTab = screen.getByRole("tab", { name: "Runs your code for real" });
    await act(async () => {
      await user.click(codeTab);
    });

    expect(codeTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText(/is_palindrome/).length).toBeGreaterThan(0);
    expect(screen.getByText(/2 failed, 1 passed/i)).toBeInTheDocument();
    // The chemistry reply text must be gone now that we've switched scenarios.
    expect(screen.queryByText(/everything balances/i)).not.toBeInTheDocument();
  });

  it("renders a Verified badge only for tool calls whose real verified flag is true, for every scenario", async () => {
    mockReducedMotion(true);
    const user = userEvent.setup();
    render(<DemoTranscript />);

    for (const scenario of scenarios) {
      const tab = screen.getByRole("tab", { name: scenario.label });
      await act(async () => {
        await user.click(tab);
      });

      const expectedVerifiedCount = scenario.frames.filter(
        (f) => f.type === "tool_end" && "verified" in f && f.verified === true
      ).length;

      const panel = screen.getByRole("tabpanel");
      const badges = within(panel).getAllByText("Verified");
      // Every real captured tool_end in this fixture happens to be verified: true, so
      // this also incidentally proves the badge count tracks the tool-call count.
      expect(badges).toHaveLength(expectedVerifiedCount);
      expect(expectedVerifiedCount).toBeGreaterThan(0);
    }
  });

  it("streams the real reply progressively via real timers, then completes with the exact captured text", async () => {
    mockReducedMotion(false);
    vi.useFakeTimers();
    try {
      render(<DemoTranscript />);
      const chemistryTab = screen.getByRole("tab", { name: "Balances a real equation" });

      act(() => {
        fireEvent.click(chemistryTab);
      });

      // Early on: the user message has arrived, but the full reply has not.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      expect(
        screen.getByText(/what are the correct balanced coefficients for c3h8/i)
      ).toBeInTheDocument();
      expect(screen.queryByText(/everything balances/i)).not.toBeInTheDocument();

      // Give it plenty of (virtual) time to finish the rest of this short scenario.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
      });

      const panel = screen.getByRole("tabpanel");
      const rendered = panel.textContent?.replace(/\s+/g, " ") ?? "";
      // The exact real captured reply text, in order — not a summary or a paraphrase.
      expect(rendered).toContain("I checked this with the chemistry solver, which balances");
      expect(rendered).toContain("C₃H₈ + 5 O₂ → 3 CO₂ + 4 H₂O");
      expect(rendered).toContain("Everything balances");
      expect(screen.getByText("Verified")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
