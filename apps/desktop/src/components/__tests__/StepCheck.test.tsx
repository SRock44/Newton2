import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageContent from "../MessageContent";
import StepCheck, { ATTEMPT_PREFIX } from "../StepCheck";

const STEP_JSON = JSON.stringify({ prompt: "Try expanding (x+3)^2 yourself" });

describe("StepCheck", () => {
  it("renders the prompt and an input with a submit button", () => {
    render(<StepCheck json={STEP_JSON} onSend={vi.fn()} />);
    expect(screen.getByText("Try expanding (x+3)^2 yourself")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /your attempt/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check my answer/i })).toBeInTheDocument();
  });

  it("the submit button is disabled until something is typed", () => {
    render(<StepCheck json={STEP_JSON} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: /check my answer/i })).toBeDisabled();
  });

  it("clicking submit sends the typed text prefixed with the documented attempt marker", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<StepCheck json={STEP_JSON} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your attempt/i }), "x^2 + 6x + 9");
    await user.click(screen.getByRole("button", { name: /check my answer/i }));

    expect(onSend).toHaveBeenCalledWith(`${ATTEMPT_PREFIX}x^2 + 6x + 9`);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("pressing Enter in the input submits the same as clicking the button", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<StepCheck json={STEP_JSON} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your attempt/i }), "x^2 + 6x + 9{Enter}");

    expect(onSend).toHaveBeenCalledWith(`${ATTEMPT_PREFIX}x^2 + 6x + 9`);
  });

  it("does not send anything for an empty or whitespace-only attempt", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<StepCheck json={STEP_JSON} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your attempt/i }), "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  describe("answered (read-only) state", () => {
    it("renders read-only with no input once answeredWith is set", () => {
      render(<StepCheck json={STEP_JSON} onSend={vi.fn()} answeredWith={`${ATTEMPT_PREFIX}x^2 + 6x + 9`} />);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("shows the student's own attempt text with the wire prefix stripped", () => {
      render(<StepCheck json={STEP_JSON} onSend={vi.fn()} answeredWith={`${ATTEMPT_PREFIX}x^2 + 6x + 9`} />);
      expect(screen.getByText("x^2 + 6x + 9")).toBeInTheDocument();
      expect(screen.queryByText(ATTEMPT_PREFIX, { exact: false })).not.toBeInTheDocument();
    });

    it("still locks read-only even if the follow-up message doesn't carry the prefix", () => {
      render(<StepCheck json={STEP_JSON} onSend={vi.fn()} answeredWith="some other message" />);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByText("some other message")).toBeInTheDocument();
    });
  });

  describe("malformed JSON", () => {
    it("shows an error state instead of throwing for invalid JSON", () => {
      render(<StepCheck json="not valid json" onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this step check/i)).toBeInTheDocument();
    });

    it("shows an error state when prompt is missing", () => {
      render(<StepCheck json={JSON.stringify({})} onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this step check/i)).toBeInTheDocument();
    });

    it("shows an error state for an empty prompt", () => {
      render(<StepCheck json={JSON.stringify({ prompt: "   " })} onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this step check/i)).toBeInTheDocument();
    });
  });
});

describe("MessageContent + step-check code fence", () => {
  it("renders a step-check fenced block as a card, not a plain code block", () => {
    const content = "```step-check\n" + STEP_JSON + "\n```";
    render(<MessageContent content={content} onSend={vi.fn()} />);

    expect(screen.getByText("Try expanding (x+3)^2 yourself")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByText("step-check")).not.toBeInTheDocument();
  });

  it("passes nextMessageContent through as the answeredWith prop, locking the block read-only", () => {
    const content = "```step-check\n" + STEP_JSON + "\n```";
    render(
      <MessageContent content={content} onSend={vi.fn()} nextMessageContent={`${ATTEMPT_PREFIX}x^2 + 6x + 9`} />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("x^2 + 6x + 9")).toBeInTheDocument();
  });

  it("invokes onSend end-to-end when submitted through the full markdown pipeline", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const content = "```step-check\n" + STEP_JSON + "\n```";
    render(<MessageContent content={content} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your attempt/i }), "x^2 + 6x + 9");
    await user.click(screen.getByRole("button", { name: /check my answer/i }));

    expect(onSend).toHaveBeenCalledWith(`${ATTEMPT_PREFIX}x^2 + 6x + 9`);
  });
});
