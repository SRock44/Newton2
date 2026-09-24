import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageContent from "../MessageContent";
import PaperPlanCard, { APPROVE_MESSAGE } from "../PaperPlanCard";

const PLAN_JSON = JSON.stringify({
  title: "The Impact of Spaced Repetition on Retention",
  style: "ieee",
  abstract_sketch: "Argues that spaced repetition measurably improves long-term retention over cramming.",
  sections: [
    { heading: "Introduction", summary: "Frames the research question and motivation." },
    { heading: "Related Work", summary: "Surveys prior studies on spaced repetition." },
  ],
  sources_needed: ["A recent meta-analysis on spaced repetition efficacy"],
});

describe("PaperPlanCard", () => {
  it("renders the title, style badge, abstract sketch, and numbered sections", () => {
    render(<PaperPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);

    expect(screen.getByText("The Impact of Spaced Repetition on Retention")).toBeInTheDocument();
    expect(screen.getByText("IEEE")).toBeInTheDocument();
    expect(screen.getByText(/measurably improves long-term retention/)).toBeInTheDocument();
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("Related Work")).toBeInTheDocument();
    expect(screen.getByText(/Frames the research question/)).toBeInTheDocument();
  });

  it("does not double the numbers when the model already numbered its headings (1. 1. Introduction)", () => {
    const numbered = JSON.stringify({
      title: "T",
      style: "arxiv",
      abstract_sketch: "Sketch.",
      sections: [
        { heading: "1. Introduction", summary: "Why." },
        { heading: "2) Methods", summary: "How." },
        { heading: "2D Poisson problem", summary: "A title that starts with a digit." },
      ],
    });
    render(<PaperPlanCard json={numbered} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("Methods")).toBeInTheDocument();
    expect(screen.getByText("2D Poisson problem")).toBeInTheDocument();
    expect(screen.queryByText(/^1\./)).not.toBeInTheDocument();
  });

  it("renders the sources-needed notes when present", () => {
    render(<PaperPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
    expect(screen.getByText("Sources still needed")).toBeInTheDocument();
    expect(screen.getByText(/meta-analysis on spaced repetition/)).toBeInTheDocument();
  });

  it("omits the sources-needed section entirely when absent", () => {
    const json = JSON.stringify({
      title: "T",
      style: "apa7",
      abstract_sketch: "Sketch.",
      sections: [{ heading: "Intro", summary: "S." }],
    });
    render(<PaperPlanCard json={json} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
    expect(screen.queryByText("Sources still needed")).not.toBeInTheDocument();
  });

  it("omits the sources-needed section when the array is empty", () => {
    const json = JSON.stringify({
      title: "T",
      style: "apa7",
      abstract_sketch: "Sketch.",
      sections: [{ heading: "Intro", summary: "S." }],
      sources_needed: [],
    });
    render(<PaperPlanCard json={json} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
    expect(screen.queryByText("Sources still needed")).not.toBeInTheDocument();
  });

  describe("when interactive", () => {
    it("shows Approve & Write and Request Changes buttons", () => {
      render(<PaperPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
      expect(screen.getByRole("button", { name: /approve.*write/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /request changes/i })).toBeInTheDocument();
    });

    it("Approve & Write sends the fixed confirmation sentence", async () => {
      const user = userEvent.setup();
      const onApprove = vi.fn();
      render(<PaperPlanCard json={PLAN_JSON} onApprove={onApprove} onRequestChanges={vi.fn()} interactive />);

      await user.click(screen.getByRole("button", { name: /approve.*write/i }));
      expect(onApprove).toHaveBeenCalledWith(APPROVE_MESSAGE);
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it("Request Changes calls onRequestChanges and sends nothing", async () => {
      const user = userEvent.setup();
      const onApprove = vi.fn();
      const onRequestChanges = vi.fn();
      render(
        <PaperPlanCard json={PLAN_JSON} onApprove={onApprove} onRequestChanges={onRequestChanges} interactive />,
      );

      await user.click(screen.getByRole("button", { name: /request changes/i }));
      // Called with the plan's own title, so the composer can show which plan the
      // student is now requesting changes to (see Composer.tsx's requestingChangesFor).
      expect(onRequestChanges).toHaveBeenCalledWith("The Impact of Spaced Repetition on Retention");
      expect(onRequestChanges).toHaveBeenCalledTimes(1);
      expect(onApprove).not.toHaveBeenCalled();
    });
  });

  // BUG: "Approve & Write" stayed clickable forever after being clicked, since approving this
  // exact plan never produces a NEWER plan block (Newton's reply is the written paper, not
  // another plan) — so `interactive` alone never goes false. Fixed the same way
  // ArtifactPlanCard.tsx's "Build it" already was.
  describe("locking after Approve & Write (a real, paid write_research_paper run each time)", () => {
    it("locks after the first click so a second click cannot start another write", async () => {
      const user = userEvent.setup();
      const onApprove = vi.fn();
      render(<PaperPlanCard json={PLAN_JSON} onApprove={onApprove} onRequestChanges={vi.fn()} interactive />);

      const approve = screen.getByRole("button", { name: /approve.*write/i });
      await user.click(approve);
      expect(onApprove).toHaveBeenCalledTimes(1);

      // The buttons are gone entirely, replaced by an honest in-progress note.
      expect(screen.queryByRole("button", { name: /approve.*write/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /request changes/i })).not.toBeInTheDocument();
      expect(screen.getByText(/writing your paper/i)).toBeInTheDocument();
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it("renders locked from the start when the conversation already moved past it", () => {
      // Reopening the conversation later: local state is gone, but the real next message in
      // the conversation still proves this plan was already acted on.
      render(
        <PaperPlanCard
          json={PLAN_JSON}
          onApprove={vi.fn()}
          onRequestChanges={vi.fn()}
          interactive
          answeredWith={APPROVE_MESSAGE}
        />,
      );
      expect(screen.queryByRole("button", { name: /approve.*write/i })).not.toBeInTheDocument();
      expect(screen.getByText(/writing your paper/i)).toBeInTheDocument();
      // The plan itself still renders — only the actions are gone.
      expect(screen.getByText("The Impact of Spaced Repetition on Retention")).toBeInTheDocument();
    });

    it("stays interactive while it hasn't been approved yet", () => {
      render(<PaperPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
      expect(screen.getByRole("button", { name: /approve.*write/i })).toBeInTheDocument();
      expect(screen.queryByText(/writing your paper/i)).not.toBeInTheDocument();
    });

    it("Request Changes does not lock the card on its own", async () => {
      const user = userEvent.setup();
      render(<PaperPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
      await user.click(screen.getByRole("button", { name: /request changes/i }));
      expect(screen.getByRole("button", { name: /approve.*write/i })).toBeInTheDocument();
    });
  });

  describe("when not interactive (superseded by a later plan)", () => {
    it("hides both action buttons and shows a stale note instead", () => {
      render(
        <PaperPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive={false} />,
      );
      expect(screen.queryByRole("button", { name: /approve.*write/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /request changes/i })).not.toBeInTheDocument();
      expect(screen.getByText(/newer plan has replaced this one/i)).toBeInTheDocument();
    });

    it("still renders the plan content itself, just without live actions", () => {
      render(
        <PaperPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive={false} />,
      );
      expect(screen.getByText("The Impact of Spaced Repetition on Retention")).toBeInTheDocument();
    });
  });

  describe("malformed JSON", () => {
    it("shows an error state instead of throwing for invalid JSON", () => {
      render(<PaperPlanCard json="not valid json" onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
      expect(screen.getByText(/couldn't render this plan/i)).toBeInTheDocument();
    });

    it("shows an error state when title is missing", () => {
      const json = JSON.stringify({
        style: "ieee",
        abstract_sketch: "Sketch.",
        sections: [{ heading: "Intro", summary: "S." }],
      });
      render(<PaperPlanCard json={json} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
      expect(screen.getByText(/couldn't render this plan/i)).toBeInTheDocument();
    });

    it("shows an error state for an empty sections array", () => {
      const json = JSON.stringify({
        title: "T",
        style: "ieee",
        abstract_sketch: "Sketch.",
        sections: [],
      });
      render(<PaperPlanCard json={json} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
      expect(screen.getByText(/couldn't render this plan/i)).toBeInTheDocument();
    });

    it("shows an error state when a section has no heading", () => {
      const json = JSON.stringify({
        title: "T",
        style: "ieee",
        abstract_sketch: "Sketch.",
        sections: [{ summary: "no heading here" }],
      });
      render(<PaperPlanCard json={json} onApprove={vi.fn()} onRequestChanges={vi.fn()} interactive />);
      expect(screen.getByText(/couldn't render this plan/i)).toBeInTheDocument();
    });
  });
});

describe("MessageContent + paper-plan code fence", () => {
  it("renders a paper-plan fenced block as a plan card, not a plain code block", () => {
    const content = "```paper-plan\n" + PLAN_JSON + "\n```";
    render(<MessageContent content={content} onSend={vi.fn()} onFocusComposer={vi.fn()} />);

    expect(screen.getByText("The Impact of Spaced Repetition on Retention")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^copy$/i })).not.toBeInTheDocument();
    expect(screen.queryByText("paper-plan")).not.toBeInTheDocument();
  });

  it("defaults to interactive when isLatestPaperPlanMessage isn't threaded through (e.g. rendered alone)", () => {
    const content = "```paper-plan\n" + PLAN_JSON + "\n```";
    render(<MessageContent content={content} onSend={vi.fn()} onFocusComposer={vi.fn()} />);
    expect(screen.getByRole("button", { name: /approve.*write/i })).toBeInTheDocument();
  });

  it("renders read-only when isLatestPaperPlanMessage is explicitly false", () => {
    const content = "```paper-plan\n" + PLAN_JSON + "\n```";
    render(
      <MessageContent
        content={content}
        onSend={vi.fn()}
        onFocusComposer={vi.fn()}
        isLatestPaperPlanMessage={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /approve.*write/i })).not.toBeInTheDocument();
  });

  it("invokes onSend end-to-end when Approve & Write is clicked through the full markdown pipeline", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const content = "```paper-plan\n" + PLAN_JSON + "\n```";
    render(<MessageContent content={content} onSend={onSend} onFocusComposer={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /approve.*write/i }));
    expect(onSend).toHaveBeenCalledWith(APPROVE_MESSAGE);
  });

  it("invokes onFocusComposer end-to-end when Request Changes is clicked", async () => {
    const user = userEvent.setup();
    const onFocusComposer = vi.fn();
    const content = "```paper-plan\n" + PLAN_JSON + "\n```";
    render(<MessageContent content={content} onSend={vi.fn()} onFocusComposer={onFocusComposer} />);

    await user.click(screen.getByRole("button", { name: /request changes/i }));
    expect(onFocusComposer).toHaveBeenCalledWith("The Impact of Spaced Repetition on Retention");
    expect(onFocusComposer).toHaveBeenCalledTimes(1);
  });

  it("locks Approve & Write end-to-end once the conversation's next message proves it was used", () => {
    const content = "```paper-plan\n" + PLAN_JSON + "\n```";
    render(
      <MessageContent
        content={content}
        onSend={vi.fn()}
        onFocusComposer={vi.fn()}
        nextMessageContent={APPROVE_MESSAGE}
      />,
    );
    expect(screen.queryByRole("button", { name: /approve.*write/i })).not.toBeInTheDocument();
    expect(screen.getByText(/writing your paper/i)).toBeInTheDocument();
  });
});
