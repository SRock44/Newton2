import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageBubble from "../MessageBubble";
import type { ChatMessage } from "../../types";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Product feedback: "the YOU and the NEWTON on the left side of the chatbox is
// annoying and stupid." The literal role-label text is gone from default view; role
// is read from the surrounding chrome instead (a small NewtonMark icon for the
// assistant, nothing for the user) plus an accessible name on the row itself, and the
// timestamp is present but visually hidden until hover (see App.css's hover-reveal
// rule -- not directly testable via jsdom's computed styles here, so this just proves
// the element still renders in the DOM for that CSS rule to apply to).
describe("MessageBubble role attribution (no literal text label)", () => {
  it("never renders the literal words 'YOU' or 'Newton' as visible text for either role", () => {
    const assistantMessage: ChatMessage = { role: "assistant", content: "Here's the answer." };
    const { container: assistantContainer } = render(
      <MessageBubble
        message={assistantMessage}
        token="tok"
        sessionId="s1"
        onOpenSuggestedPanel={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );
    expect(screen.queryByText(/^you$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^newton$/i)).not.toBeInTheDocument();

    const userMessage: ChatMessage = { role: "user", content: "What's the answer?" };
    const { container: userContainer } = render(
      <MessageBubble message={userMessage} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );
    expect(screen.queryByText(/^you$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^newton$/i)).not.toBeInTheDocument();

    expect(assistantContainer.querySelector(".transcript-role")).toBeNull();
    expect(userContainer.querySelector(".transcript-role")).toBeNull();
  });

  it("renders a NewtonMark icon in the gutter for an assistant message, and none at all for a user message", () => {
    const assistantMessage: ChatMessage = { role: "assistant", content: "Here's the answer." };
    const { container: assistantContainer } = render(
      <MessageBubble
        message={assistantMessage}
        token="tok"
        sessionId="s1"
        onOpenSuggestedPanel={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );
    expect(assistantContainer.querySelector(".transcript-gutter svg.transcript-mark")).toBeInTheDocument();

    const userMessage: ChatMessage = { role: "user", content: "What's the answer?" };
    const { container: userContainer } = render(
      <MessageBubble message={userMessage} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );
    expect(userContainer.querySelector(".transcript-gutter svg")).toBeNull();
  });

  it("still exposes role as an accessible name on the row, for screen-reader users", () => {
    const assistantMessage: ChatMessage = { role: "assistant", content: "Here's the answer." };
    render(
      <MessageBubble
        message={assistantMessage}
        token="tok"
        sessionId="s1"
        onOpenSuggestedPanel={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Newton")).toBeInTheDocument();
  });

  it("keeps the timestamp in the DOM (for App.css's hover-reveal rule) rather than never rendering it", () => {
    const message: ChatMessage = { role: "assistant", content: "Hi.", created_at: new Date().toISOString() };
    const { container } = render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );
    expect(container.querySelector(".transcript-time")).toBeInTheDocument();
  });
});

describe("MessageBubble", () => {
  it("renders plain messages without an attached-image marker unaffected", () => {
    const message: ChatMessage = { role: "assistant", content: "Just some text." };
    render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );
    expect(screen.getByText("Just some text.")).toBeInTheDocument();
  });

  it("renders no suggested-action button when the message has none", () => {
    const message: ChatMessage = { role: "assistant", content: "Just some text." };
    render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // Regression coverage for every shape the backend's _TOOL_TO_SUGGESTED_ACTION map can
  // actually send (see services/api/app/routers/chat.py) — generate_study_plan and
  // sync_google_classroom deliberately land on the same "study_plan" panel/label pair,
  // so this also proves that sharing doesn't need any special-casing here.
  const suggestedActionCases: { fromTool: string; panel: string; label: string }[] = [
    { fromTool: "generate_flashcards", panel: "flashcards", label: "Open Flashcards" },
    { fromTool: "generate_practice_exam", panel: "practice_exams", label: "Open Practice Exams" },
    { fromTool: "generate_study_plan", panel: "study_plan", label: "Open Study Plan" },
    { fromTool: "sync_google_classroom", panel: "study_plan", label: "Open Study Plan" },
  ];

  it.each(suggestedActionCases)(
    "renders a clickable '$label' button (from $fromTool) that opens panel '$panel'",
    async ({ panel, label }) => {
      const user = userEvent.setup();
      const onOpenSuggestedPanel = vi.fn();
      const message: ChatMessage = {
        role: "assistant",
        content: "All done.",
        suggestedActions: [{ panel, label }],
      };
      render(
        <MessageBubble
          message={message}
          token="tok"
          sessionId="s1"
          onOpenSuggestedPanel={onOpenSuggestedPanel}
          onOpenDocument={vi.fn()}
        />,
      );

      const button = screen.getByRole("button", { name: new RegExp(label) });
      await user.click(button);

      expect(onOpenSuggestedPanel).toHaveBeenCalledWith(panel);
      expect(onOpenSuggestedPanel).toHaveBeenCalledTimes(1);
    },
  );

  it("renders more than one suggested action on the same reply without clobbering either", async () => {
    const user = userEvent.setup();
    const onOpenSuggestedPanel = vi.fn();
    const message: ChatMessage = {
      role: "assistant",
      content: "Made you both a study plan and some flashcards.",
      suggestedActions: [
        { panel: "study_plan", label: "Open Study Plan" },
        { panel: "flashcards", label: "Open Flashcards" },
      ],
    };
    render(
      <MessageBubble
        message={message}
        token="tok"
        sessionId="s1"
        onOpenSuggestedPanel={onOpenSuggestedPanel}
        onOpenDocument={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /open study plan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open flashcards/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open flashcards/i }));
    expect(onOpenSuggestedPanel).toHaveBeenCalledWith("flashcards");
  });

  it("strips the [Attached image: <id>] marker from the visible text and renders a thumbnail instead", async () => {
    const blob = new Blob(["fake-bytes"], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => blob })),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake-url"),
      revokeObjectURL: vi.fn(),
    });

    const message: ChatMessage = {
      role: "user",
      content: "What's going on here?\n\n[Attached image: cb01da7d-0f16-4b08-9945-5aca60855cf5]",
    };
    render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );

    // The raw bracket/UUID text must never be visible...
    expect(screen.queryByText(/Attached image: cb01da7d/)).not.toBeInTheDocument();
    // ...the rest of the message still is...
    expect(screen.getByText("What's going on here?")).toBeInTheDocument();
    // ...and a real thumbnail renders in its place.
    const img = await screen.findByAltText("Attached to this message");
    expect(img).toHaveAttribute("src", "blob:fake-url");
  });

  it("shows a clean fallback chip, not a broken image, when the attachment has expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );

    const message: ChatMessage = {
      role: "user",
      content: "[Attached image: some-old-id]",
    };
    render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("strips the [Attached document: <id>|<filename>] marker from the visible text and renders a chip instead", () => {
    const message: ChatMessage = {
      role: "user",
      content: "Let's talk about `syllabus.pdf`.\n\n[Attached document: doc-1|syllabus.pdf]",
    };
    render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );

    expect(screen.queryByText(/Attached document: doc-1/)).not.toBeInTheDocument();
    expect(screen.getByText(/Let's talk about/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /syllabus\.pdf/i })).toBeInTheDocument();
  });

  it("clicking an attached-document chip navigates to that document", async () => {
    const user = userEvent.setup();
    const onOpenDocument = vi.fn();
    const message: ChatMessage = {
      role: "user",
      content: "[Attached document: doc-42|notes.txt]",
    };
    render(
      <MessageBubble
        message={message}
        token="tok"
        sessionId="s1"
        onOpenSuggestedPanel={vi.fn()}
        onOpenDocument={onOpenDocument}
      />,
    );

    await user.click(screen.getByRole("button", { name: /notes\.txt/i }));
    expect(onOpenDocument).toHaveBeenCalledWith("doc-42");
    expect(onOpenDocument).toHaveBeenCalledTimes(1);
  });

  it("renders both an attached image and an attached document on the same message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(["x"], { type: "image/png" }) })),
    );
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:fake-url"), revokeObjectURL: vi.fn() });

    const message: ChatMessage = {
      role: "user",
      content: "See both.\n\n[Attached image: img-1]\n\n[Attached document: doc-1|report.pdf]",
    };
    render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );

    expect(await screen.findByAltText("Attached to this message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /report\.pdf/i })).toBeInTheDocument();
    expect(screen.getByText("See both.")).toBeInTheDocument();
  });

  // Item 2 (ROADMAP.md): the streaming dots used to show for the entire duration
  // message.streaming was true, even once real text/activity/plan content had already
  // started rendering above them -- two "still loading" signals stacked on top of
  // content that had visibly already arrived. Now they only show when there is
  // genuinely nothing yet to show for this message.
  describe("streaming dots visibility", () => {
    it("shows the streaming dots while there is genuinely nothing to show yet", () => {
      const message: ChatMessage = { role: "assistant", content: "", streaming: true };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      expect(screen.getByLabelText("Newton is thinking")).toBeInTheDocument();
    });

    it("does not show the streaming dots once a finished/non-streaming message renders", () => {
      const message: ChatMessage = { role: "assistant", content: "Done.", streaming: false };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      expect(screen.queryByLabelText("Newton is thinking")).not.toBeInTheDocument();
    });

    it("hides the streaming dots once real text content has arrived", () => {
      const message: ChatMessage = { role: "assistant", content: "Some real text has landed.", streaming: true };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      expect(screen.queryByLabelText("Newton is thinking")).not.toBeInTheDocument();
    });

    it("hides the streaming dots once tool activity has arrived, even with no text yet", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        activity: [{ tool: "web_search", label: "Searching the web", done: false }],
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      expect(screen.queryByLabelText("Newton is thinking")).not.toBeInTheDocument();
    });

    it("hides the streaming dots once a plan-narration chip has arrived, even with no text or activity yet", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        planNarration: "I'll walk through this step by step.",
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      expect(screen.queryByLabelText("Newton is thinking")).not.toBeInTheDocument();
    });
  });

  // Item 4 (ROADMAP.md): the plan-narration chip ("cheap, honest thinking" -- a short
  // model-generated plan sentence rendered before any tool activity or real answer
  // text). Reuses .tool-activity-chip's chrome via a distinguishing .plan-chip class.
  describe("plan-narration chip", () => {
    it("renders nothing when the message has no plan narration", () => {
      const message: ChatMessage = { role: "assistant", content: "hi", streaming: false };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      expect(screen.queryByLabelText("Newton's plan")).not.toBeInTheDocument();
    });

    it("renders the plan narration text as a distinct .plan-chip", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        planNarration: "Planning the explanation.",
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Planning the explanation.");
      expect(chip.closest(".plan-chip")).toBeInTheDocument();
    });

    it("keeps the plan chip in its live (not-done) state while no text or activity has landed yet", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        planNarration: "Planning the explanation.",
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Planning the explanation.").closest(".plan-chip");
      expect(chip).not.toHaveClass("tool-activity-chip--done");
    });

    it("gives the still-live plan chip a continuous shimmer treatment, not static text", () => {
      // Direct product feedback: once the plan chip landed, it just sat there
      // completely static for however many more seconds the real answer took --
      // .plan-chip--live keeps the chip's own text visibly animating for the whole
      // wait, not just its small corner icon.
      const message: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        planNarration: "Planning the explanation.",
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Planning the explanation.").closest(".plan-chip");
      expect(chip).toHaveClass("plan-chip--live");
    });

    it("drops the live shimmer class the moment the chip is marked done", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "Here's the explanation.",
        streaming: true,
        planNarration: "Planning the explanation.",
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Planning the explanation.").closest(".plan-chip");
      expect(chip).not.toHaveClass("plan-chip--live");
    });

    it("marks the plan chip done (same grayed-out treatment as a finished tool chip) once real text has landed", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "Here's the explanation.",
        streaming: true,
        planNarration: "Planning the explanation.",
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Planning the explanation.").closest(".plan-chip");
      expect(chip).toHaveClass("tool-activity-chip--done");
    });

    it("marks the plan chip done once tool activity has landed, even with no text yet", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        planNarration: "Planning the explanation.",
        activity: [{ tool: "calculator", label: "Doing the math", done: false }],
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Planning the explanation.").closest(".plan-chip");
      expect(chip).toHaveClass("tool-activity-chip--done");
    });

    it("renders the plan chip before tool-activity chips", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        planNarration: "Planning the explanation.",
        activity: [{ tool: "calculator", label: "Doing the math", done: false }],
      };
      const { container } = render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chips = Array.from(container.querySelectorAll(".tool-activity-chip")).map((el) => el.textContent);
      expect(chips[0]).toContain("Planning the explanation.");
      expect(chips[1]).toContain("Doing the math");
    });
  });
});
