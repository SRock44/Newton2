import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageContent from "../MessageContent";
import MathSteps from "../MathSteps";

describe("MathSteps", () => {
  it("shows only the first step initially, with a button describing what it will reveal next", () => {
    const json = JSON.stringify({ steps: ["First step", "Second step", "Third step"] });
    render(<MathSteps json={json} />);

    expect(screen.getByText("First step")).toBeInTheDocument();
    expect(screen.queryByText("Second step")).not.toBeInTheDocument();
    expect(screen.queryByText("Third step")).not.toBeInTheDocument();
    // Describes what clicking will reveal (2 of 3) — not what's already shown (1 of 3),
    // which read as "you're already on step 1/5" while sitting on the first step.
    expect(screen.getByRole("button", { name: /show next step \(2\/3\)/i })).toBeInTheDocument();
  });

  it("reveals one more step per click, updates the button's count each time, and removes it once all are shown", async () => {
    const user = userEvent.setup();
    const json = JSON.stringify({ steps: ["First", "Second", "Third"] });
    render(<MathSteps json={json} />);

    await user.click(screen.getByRole("button", { name: /show next step \(2\/3\)/i }));
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("Third")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show next step \(3\/3\)/i }));
    expect(screen.getByText("Third")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show next step/i })).not.toBeInTheDocument();
  });

  it("persists revealed progress under a given storageKey, and restores it on remount", async () => {
    const user = userEvent.setup();
    const json = JSON.stringify({ steps: ["First", "Second", "Third", "Fourth"] });
    const { unmount } = render(<MathSteps json={json} storageKey="test:key:1" />);

    await user.click(screen.getByRole("button", { name: /show next step \(2\/4\)/i }));
    await user.click(screen.getByRole("button", { name: /show next step \(3\/4\)/i }));
    expect(screen.getByText("Third")).toBeInTheDocument();
    unmount();

    // Simulates leaving this chat (unmounting the component) and coming back —
    // the exact scenario that used to silently reset progress to step 1.
    render(<MathSteps json={json} storageKey="test:key:1" />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
    expect(screen.queryByText("Fourth")).not.toBeInTheDocument();
  });

  it("a different storageKey never shares progress with another block", () => {
    window.localStorage.setItem("test:key:A", "3");
    const json = JSON.stringify({ steps: ["1", "2", "3", "4"] });
    render(<MathSteps json={json} storageKey="test:key:B" />);
    // key B has no stored progress of its own — starts fresh at step 1, unaffected by A.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("with no storageKey, behaves exactly as before (in-memory only, starts at step 1)", () => {
    const json = JSON.stringify({ steps: ["First", "Second"] });
    render(<MathSteps json={json} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.queryByText("Second")).not.toBeInTheDocument();
  });

  it("renders inline LaTeX within a step through the normal markdown pipeline", () => {
    const json = JSON.stringify({ steps: ["Solve $x^2 = 4$ for x"] });
    const { container } = render(<MathSteps json={json} />);
    expect(container.querySelector(".katex")).toBeInTheDocument();
  });

  it("shows an error state for invalid JSON instead of throwing", () => {
    render(<MathSteps json="not valid json" />);
    expect(screen.getByText(/couldn't render these steps/i)).toBeInTheDocument();
  });

  it("shows an error state for an empty steps array", () => {
    render(<MathSteps json={JSON.stringify({ steps: [] })} />);
    expect(screen.getByText(/couldn't render these steps/i)).toBeInTheDocument();
  });

  it("shows an error state when steps contains a non-string entry", () => {
    render(<MathSteps json={JSON.stringify({ steps: ["ok", 42] })} />);
    expect(screen.getByText(/couldn't render these steps/i)).toBeInTheDocument();
  });

  it("a single-step derivation shows no reveal button", () => {
    render(<MathSteps json={JSON.stringify({ steps: ["Only step, answer is 4"] })} />);
    expect(screen.getByText("Only step, answer is 4")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("MessageContent + math-steps code fence", () => {
  it("renders a math-steps fenced block as a progressive-reveal derivation, not a plain code block", () => {
    const content = '```math-steps\n{"steps": ["Step one", "Step two"]}\n```';
    render(<MessageContent content={content} />);

    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.queryByText("Step two")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show next step/i })).toBeInTheDocument();
    // a real code block would have a copy button and a language label; this shouldn't.
    expect(screen.queryByRole("button", { name: /^copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByText("math-steps")).not.toBeInTheDocument();
  });

  it("persists reveal progress end-to-end through MessageContent's persistKey, and restores it on remount", async () => {
    const user = userEvent.setup();
    const content = '```math-steps\n{"steps": ["Alpha", "Beta", "Gamma"]}\n```';

    const { unmount } = render(<MessageContent content={content} persistKey="s1|2026-01-01T00:00:00Z" />);
    await user.click(screen.getByRole("button", { name: /show next step \(2\/3\)/i }));
    expect(screen.getByText("Beta")).toBeInTheDocument();
    unmount();

    render(<MessageContent content={content} persistKey="s1|2026-01-01T00:00:00Z" />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
  });

  it("a different persistKey (a different message) never shares progress with another", async () => {
    const user = userEvent.setup();
    const content = '```math-steps\n{"steps": ["Alpha", "Beta", "Gamma"]}\n```';

    render(<MessageContent content={content} persistKey="s2|2026-01-01T00:00:00Z" />);
    await user.click(screen.getByRole("button", { name: /show next step \(2\/3\)/i }));

    render(<MessageContent content={content} persistKey="s2|2026-01-02T00:00:00Z" />);
    // The second render is a *different* message — must start fresh, not inherit
    // progress from an unrelated math-steps block elsewhere.
    const alphas = screen.getAllByText("Alpha");
    expect(alphas.length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Gamma")).toHaveLength(0);
  });
});
