import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageContent from "../MessageContent";
import StepCheck, { ATTEMPT_PREFIX } from "../StepCheck";

const STEP_JSON = JSON.stringify({ prompt: "Try expanding (x+3)^2 yourself" });

// StepCheck's own logic (parsing, submit-gating, the ATTEMPT_PREFIX/$...$ wrapping, the
// answered/read-only switch) is what these tests actually exercise — MathInput.tsx's own
// MathLive-wrapping behavior has its own dedicated test file (MathInput.test.tsx). So,
// same "mock the imperative library at whichever boundary is cleanest" idiom
// PlotlyFigure.test.tsx uses for Plotly, this mocks MathInput itself down to a plain
// accessible text field: real value/onChange/onSubmit wiring, none of MathLive's DOM.
vi.mock("../MathInput", () => ({
  default: ({
    value,
    onChange,
    onSubmit,
    placeholder,
    ariaLabel,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSubmit?: () => void;
    placeholder?: string;
    ariaLabel?: string;
  }) => (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit?.();
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  ),
}));

describe("StepCheck", () => {
  it("renders the prompt and a math input with a submit button", () => {
    render(<StepCheck json={STEP_JSON} onSend={vi.fn()} />);
    expect(screen.getByText("Try expanding (x+3)^2 yourself")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /your attempt/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check my answer/i })).toBeInTheDocument();
  });

  it("the submit button is disabled until something is typed", () => {
    render(<StepCheck json={STEP_JSON} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: /check my answer/i })).toBeDisabled();
  });

  it("clicking submit sends the typed expression prefixed with the attempt marker and wrapped as inline math", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<StepCheck json={STEP_JSON} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your attempt/i }), "x^2 + 6x + 9");
    await user.click(screen.getByRole("button", { name: /check my answer/i }));

    expect(onSend).toHaveBeenCalledWith(`${ATTEMPT_PREFIX}$x^2 + 6x + 9$`);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("pressing Enter in the field submits the same as clicking the button", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<StepCheck json={STEP_JSON} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your attempt/i }), "x^2 + 6x + 9{Enter}");

    expect(onSend).toHaveBeenCalledWith(`${ATTEMPT_PREFIX}$x^2 + 6x + 9$`);
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
      render(<StepCheck json={STEP_JSON} onSend={vi.fn()} answeredWith={`${ATTEMPT_PREFIX}$x^2 + 6x + 9$`} />);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders the submitted expression as real typeset KaTeX, not raw LaTeX source, with the wire prefix stripped", () => {
      const { container } = render(
        <StepCheck json={STEP_JSON} onSend={vi.fn()} answeredWith={`${ATTEMPT_PREFIX}$x^2 + 6x + 9$`} />,
      );
      expect(container.querySelectorAll(".katex").length).toBeGreaterThan(0);
      expect(container.textContent).not.toContain(ATTEMPT_PREFIX);
      expect(container.textContent).not.toContain("$x^2 + 6x + 9$");
    });

    it("still locks read-only and renders plainly even if the follow-up message doesn't carry the prefix or math delimiters", () => {
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
      <MessageContent
        content={content}
        onSend={vi.fn()}
        nextMessageContent={`${ATTEMPT_PREFIX}$x^2 + 6x + 9$`}
      />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't render this step check/i)).not.toBeInTheDocument();
  });

  it("invokes onSend end-to-end when submitted through the full markdown pipeline, wrapped as inline math", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const content = "```step-check\n" + STEP_JSON + "\n```";
    render(<MessageContent content={content} onSend={onSend} />);

    await user.type(screen.getByRole("textbox", { name: /your attempt/i }), "x^2 + 6x + 9");
    await user.click(screen.getByRole("button", { name: /check my answer/i }));

    expect(onSend).toHaveBeenCalledWith(`${ATTEMPT_PREFIX}$x^2 + 6x + 9$`);
  });
});
