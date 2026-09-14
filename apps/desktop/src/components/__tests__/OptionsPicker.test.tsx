import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageContent from "../MessageContent";
import OptionsPicker from "../OptionsPicker";

const CITATION_JSON = JSON.stringify({
  question: "Which citation style should this paper use?",
  options: [
    { label: "IEEE", description: "Numbered references, standard for engineering/CS.", recommended: true },
    { label: "APA 7", description: "Author-date references, standard for humanities." },
  ],
  multiSelect: false,
});

describe("OptionsPicker", () => {
  it("renders the question and every option's label and description", () => {
    render(<OptionsPicker json={CITATION_JSON} onSend={vi.fn()} />);
    expect(screen.getByText("Which citation style should this paper use?")).toBeInTheDocument();
    expect(screen.getByText("IEEE")).toBeInTheDocument();
    expect(screen.getByText("APA 7")).toBeInTheDocument();
    expect(screen.getByText(/Numbered references/)).toBeInTheDocument();
  });

  it("visually distinguishes the recommended option with a badge", () => {
    render(<OptionsPicker json={CITATION_JSON} onSend={vi.fn()} />);
    expect(screen.getByText("Recommended")).toBeInTheDocument();
  });

  it("single-select: clicking an option immediately sends its exact label text", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<OptionsPicker json={CITATION_JSON} onSend={onSend} />);

    await user.click(screen.getByRole("button", { name: /IEEE/ }));
    expect(onSend).toHaveBeenCalledWith("IEEE");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("single-select: renders plain buttons, not checkboxes", () => {
    render(<OptionsPicker json={CITATION_JSON} onSend={vi.fn()} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  describe("multi-select", () => {
    const MULTI_JSON = JSON.stringify({
      question: "Which sections still need sources?",
      options: [{ label: "Intro" }, { label: "Related Work" }, { label: "Methods" }],
      multiSelect: true,
    });

    it("renders checkboxes and a Confirm button, disabled until something is checked", () => {
      render(<OptionsPicker json={MULTI_JSON} onSend={vi.fn()} />);
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
      expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    });

    it("does not send anything just from checking a box", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<OptionsPicker json={MULTI_JSON} onSend={onSend} />);
      await user.click(screen.getByRole("checkbox", { name: /Intro/ }));
      expect(onSend).not.toHaveBeenCalled();
      expect(screen.getByRole("checkbox", { name: /Intro/ })).toHaveAttribute("aria-checked", "true");
    });

    it("Confirm sends the checked labels, comma-joined, in the given order", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<OptionsPicker json={MULTI_JSON} onSend={onSend} />);

      await user.click(screen.getByRole("checkbox", { name: /Methods/ }));
      await user.click(screen.getByRole("checkbox", { name: /Intro/ }));
      await user.click(screen.getByRole("button", { name: /confirm/i }));

      expect(onSend).toHaveBeenCalledWith("Intro, Methods");
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    it("unchecking a box removes it from what Confirm would send", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<OptionsPicker json={MULTI_JSON} onSend={onSend} />);

      const intro = screen.getByRole("checkbox", { name: /Intro/ });
      await user.click(intro);
      await user.click(intro);
      expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    });
  });

  describe("answered (read-only) state", () => {
    it("renders read-only with no clickable buttons once answeredWith is set", () => {
      render(<OptionsPicker json={CITATION_JSON} onSend={vi.fn()} answeredWith="IEEE" />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("shows a checkmark on the option matching the follow-up message's exact text", () => {
      render(<OptionsPicker json={CITATION_JSON} onSend={vi.fn()} answeredWith="IEEE" />);
      const picked = screen.getByText("IEEE").closest(".options-picker__option");
      expect(picked).toHaveClass("options-picker__option--picked");
      const other = screen.getByText("APA 7").closest(".options-picker__option");
      expect(other).not.toHaveClass("options-picker__option--picked");
    });

    it("clicking a rendered card in the answered state does nothing (it's a plain div, not a button)", async () => {
      const onSend = vi.fn();
      render(<OptionsPicker json={CITATION_JSON} onSend={onSend} answeredWith="IEEE" />);
      const picked = screen.getByText("IEEE").closest(".options-picker__option");
      expect(picked?.tagName).toBe("DIV");
      expect(onSend).not.toHaveBeenCalled();
    });

    it("still locks read-only even when the follow-up text doesn't match any label", () => {
      render(<OptionsPicker json={CITATION_JSON} onSend={vi.fn()} answeredWith="Something else entirely" />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      // No option carries the picked mark since nothing matched.
      expect(screen.queryByText("✓")).not.toBeInTheDocument();
    });

    it("matches a multi-select answer against the comma-joined list of picked labels", () => {
      const MULTI_JSON = JSON.stringify({
        question: "Pick sections",
        options: [{ label: "Intro" }, { label: "Methods" }],
        multiSelect: true,
      });
      render(<OptionsPicker json={MULTI_JSON} onSend={vi.fn()} answeredWith="Intro, Methods" />);
      expect(screen.getByText("Intro").closest(".options-picker__option")).toHaveClass(
        "options-picker__option--picked",
      );
      expect(screen.getByText("Methods").closest(".options-picker__option")).toHaveClass(
        "options-picker__option--picked",
      );
    });
  });

  describe("malformed JSON", () => {
    it("shows an error state instead of throwing for invalid JSON", () => {
      render(<OptionsPicker json="not valid json" onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this question/i)).toBeInTheDocument();
    });

    it("shows an error state when question is missing", () => {
      const json = JSON.stringify({ options: [{ label: "A" }] });
      render(<OptionsPicker json={json} onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this question/i)).toBeInTheDocument();
    });

    it("shows an error state for an empty options array", () => {
      const json = JSON.stringify({ question: "Q?", options: [] });
      render(<OptionsPicker json={json} onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this question/i)).toBeInTheDocument();
    });

    it("shows an error state for more than 4 options", () => {
      const json = JSON.stringify({
        question: "Q?",
        options: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }, { label: "E" }],
      });
      render(<OptionsPicker json={json} onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this question/i)).toBeInTheDocument();
    });

    it("shows an error state when an option has no label", () => {
      const json = JSON.stringify({ question: "Q?", options: [{ description: "no label here" }] });
      render(<OptionsPicker json={json} onSend={vi.fn()} />);
      expect(screen.getByText(/couldn't render this question/i)).toBeInTheDocument();
    });
  });
});

describe("MessageContent + options code fence", () => {
  it("renders an options fenced block as a picker, not a plain code block", () => {
    const content = "```options\n" + CITATION_JSON + "\n```";
    render(<MessageContent content={content} onSend={vi.fn()} />);

    expect(screen.getByText("Which citation style should this paper use?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByText("options")).not.toBeInTheDocument();
  });

  it("passes nextMessageContent through as the answeredWith prop, locking the block read-only", () => {
    const content = "```options\n" + CITATION_JSON + "\n```";
    render(<MessageContent content={content} onSend={vi.fn()} nextMessageContent="IEEE" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("IEEE").closest(".options-picker__option")).toHaveClass(
      "options-picker__option--picked",
    );
  });

  it("invokes onSend end-to-end when a card is clicked through the full markdown pipeline", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const content = "```options\n" + CITATION_JSON + "\n```";
    render(<MessageContent content={content} onSend={onSend} />);

    await user.click(screen.getByRole("button", { name: /APA 7/ }));
    expect(onSend).toHaveBeenCalledWith("APA 7");
  });
});
