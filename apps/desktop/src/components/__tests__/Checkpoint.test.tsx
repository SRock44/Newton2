import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageContent from "../MessageContent";
import Checkpoint from "../Checkpoint";

const CHECKPOINT_JSON = JSON.stringify({
  question: "Why does the exponent on the denominator become negative?",
});

describe("Checkpoint", () => {
  it("renders the question and an input with a submit button", () => {
    render(<Checkpoint json={CHECKPOINT_JSON} onSend={vi.fn()} />);
    expect(screen.getByText("Why does the exponent on the denominator become negative?")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /your answer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^answer$/i })).toBeInTheDocument();
  });

  it("the submit button is disabled until something is typed", () => {
    render(<Checkpoint json={CHECKPOINT_JSON} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^answer$/i })).toBeDisabled();
  });

  it("clicking submit sends the typed answer verbatim, with no prefix", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Checkpoint json={CHECKPOINT_JSON} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your answer/i }), "Negative exponents mean division");
    await user.click(screen.getByRole("button", { name: /^answer$/i }));

    expect(onSend).toHaveBeenCalledWith("Negative exponents mean division");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("pressing Enter in the input submits the same as clicking the button", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Checkpoint json={CHECKPOINT_JSON} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your answer/i }), "because it flips{Enter}");
    expect(onSend).toHaveBeenCalledWith("because it flips");
  });

  it("does not send anything for an empty or whitespace-only answer", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Checkpoint json={CHECKPOINT_JSON} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your answer/i }), "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  describe("answered (read-only) state", () => {
    it("renders read-only with no input once answeredWith is set", () => {
      render(<Checkpoint json={CHECKPOINT_JSON} onSend={vi.fn()} answeredWith="because it flips" />);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("shows the student's own answer text", () => {
      render(<Checkpoint json={CHECKPOINT_JSON} onSend={vi.fn()} answeredWith="because it flips" />);
      expect(screen.getByText("because it flips")).toBeInTheDocument();
    });
  });

  describe("malformed JSON", () => {
    it("shows an error state instead of throwing for invalid JSON", () => {
      render(<Checkpoint json="not valid json" onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this checkpoint/i)).toBeInTheDocument();
    });

    it("shows an error state when question is missing", () => {
      render(<Checkpoint json={JSON.stringify({})} onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this checkpoint/i)).toBeInTheDocument();
    });

    it("shows an error state for an empty question", () => {
      render(<Checkpoint json={JSON.stringify({ question: "   " })} onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this checkpoint/i)).toBeInTheDocument();
    });
  });
});

describe("MessageContent + checkpoint code fence", () => {
  it("renders a checkpoint fenced block as a card, not a plain code block", () => {
    const content = "```checkpoint\n" + CHECKPOINT_JSON + "\n```";
    render(<MessageContent content={content} onSend={vi.fn()} />);

    expect(screen.getByText("Why does the exponent on the denominator become negative?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByText("checkpoint")).not.toBeInTheDocument();
  });

  it("passes nextMessageContent through as the answeredWith prop, locking the block read-only", () => {
    const content = "```checkpoint\n" + CHECKPOINT_JSON + "\n```";
    render(<MessageContent content={content} onSend={vi.fn()} nextMessageContent="because it flips" />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("because it flips")).toBeInTheDocument();
  });

  it("invokes onSend end-to-end when submitted through the full markdown pipeline", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const content = "```checkpoint\n" + CHECKPOINT_JSON + "\n```";
    render(<MessageContent content={content} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your answer/i }), "because it flips");
    await user.click(screen.getByRole("button", { name: /^answer$/i }));

    expect(onSend).toHaveBeenCalledWith("because it flips");
  });
});

describe("StepCheck vs Checkpoint visual distinction", () => {
  it("renders under distinct top-level CSS classes", async () => {
    const stepCheckJson = JSON.stringify({ prompt: "Try it" });
    const stepContent = "```step-check\n" + stepCheckJson + "\n```";
    const { container: stepContainer } = render(<MessageContent content={stepContent} onSend={vi.fn()} />);
    expect(stepContainer.querySelector(".step-check")).toBeInTheDocument();
    expect(stepContainer.querySelector(".checkpoint")).not.toBeInTheDocument();

    const checkpointContent = "```checkpoint\n" + CHECKPOINT_JSON + "\n```";
    const { container: checkpointContainer } = render(<MessageContent content={checkpointContent} onSend={vi.fn()} />);
    expect(checkpointContainer.querySelector(".checkpoint")).toBeInTheDocument();
    expect(checkpointContainer.querySelector(".step-check")).not.toBeInTheDocument();
  });
});
