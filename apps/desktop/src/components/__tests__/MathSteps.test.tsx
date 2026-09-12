import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageContent from "../MessageContent";
import MathSteps from "../MathSteps";

describe("MathSteps", () => {
  it("shows only the first step initially, with a button to reveal more", () => {
    const json = JSON.stringify({ steps: ["First step", "Second step", "Third step"] });
    render(<MathSteps json={json} />);

    expect(screen.getByText("First step")).toBeInTheDocument();
    expect(screen.queryByText("Second step")).not.toBeInTheDocument();
    expect(screen.queryByText("Third step")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show next step \(1\/3\)/i })).toBeInTheDocument();
  });

  it("reveals one more step per click, and removes the button once all are shown", async () => {
    const user = userEvent.setup();
    const json = JSON.stringify({ steps: ["First", "Second", "Third"] });
    render(<MathSteps json={json} />);

    await user.click(screen.getByRole("button", { name: /show next step/i }));
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("Third")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show next step \(2\/3\)/i }));
    expect(screen.getByText("Third")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show next step/i })).not.toBeInTheDocument();
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
});
