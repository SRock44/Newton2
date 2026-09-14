import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OnboardingWelcome from "../OnboardingWelcome";

describe("OnboardingWelcome", () => {
  it("shows a welcome heading and several clickable example prompts", () => {
    render(<OnboardingWelcome onSend={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /welcome to newton/i })).toBeInTheDocument();
    // At least two example prompts, per the design goal of 2-4 concrete, clickable
    // options rather than a wall of prose.
    const prompts = screen.getAllByRole("button").filter((btn) => btn.getAttribute("aria-label") !== "Dismiss welcome");
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts.length).toBeLessThanOrEqual(4);
  });

  it("clicking an example prompt sends its exact text and dismisses the card", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onDismiss = vi.fn();
    render(<OnboardingWelcome onSend={onSend} onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: /solve an equation step by step/i }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Solve this step by step: 2x + 5 = 15");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses without sending anything when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onDismiss = vi.fn();
    render(<OnboardingWelcome onSend={onSend} onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: /dismiss welcome/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("only references real, honest capabilities — never document-dependent generation a brand-new account can't use yet", () => {
    render(<OnboardingWelcome onSend={vi.fn()} onDismiss={vi.fn()} />);
    // Flashcard/practice-exam/study-plan generation all require an uploaded document
    // (see services/api/app/tools/flashcard_generation.py etc.) which a first-run
    // account doesn't have yet — none of the example prompts should promise those.
    expect(screen.queryByText(/flashcard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/practice exam/i)).not.toBeInTheDocument();
  });
});
