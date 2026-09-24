import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageBubble from "../MessageBubble";
import type { ChatMessage } from "../../types";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return { ...actual, synthesizeSpeech: vi.fn() };
});

import { ApiError, synthesizeSpeech } from "../../api";

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
    const { container } = render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );
    expect(container.querySelector(".suggested-action-btn")).toBeNull();
    // The only button on a plain finished reply is the "Listen" action (see the
    // "Listen" suite below) — deliberately asserted rather than assuming zero buttons,
    // so this keeps catching a stray suggested action.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /read this message aloud/i })).toBeInTheDocument();
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

  it("renders the document card BELOW the message text, not above it", () => {
    // Feedback: a student had to scroll back up past Newton's reply to reach the
    // document it produced. The card now comes after the text in DOM order, so it's
    // the next thing you see, not something you scroll up to find.
    const message: ChatMessage = {
      role: "assistant",
      content: "Done — here's your paper.\n\n[Attached document: doc-1|paper.pdf]",
    };
    render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );

    const text = screen.getByText(/Done — here's your paper/);
    const chip = screen.getByRole("button", { name: /paper\.pdf/i });
    // DOCUMENT_POSITION_FOLLOWING: `chip` comes after `text` in the document.
    // eslint-disable-next-line no-bitwise
    expect(text.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(onOpenDocument).toHaveBeenCalledWith("doc-42", "notes.txt");
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

  // Product review finding: "verified, not vibes" was invisible in the product -- every
  // tool chip rendered identically whether the underlying result was a real computation
  // (SymPy, a real sandboxed test run, ...) or an LLM judgment call. The backend now
  // sends a real, server-computed `verified` flag on a finished tool_end frame (see
  // services/api/app/agents/tutor.py's _COMPUTATIONALLY_VERIFIED_TOOLS/
  // _tool_result_verified and app/routers/chat.py), threaded onto ToolActivityEntry.
  // These tests cover both the verified-chip path and the (must stay unchanged)
  // non-verified path.
  describe("verified tool-activity chip", () => {
    it("gives a finished, computationally-verified tool call a distinct verified badge/class", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "Correct!",
        streaming: false,
        activity: [{ tool: "check_student_work", label: "Checking your work", done: true, verified: true }],
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Checking your work").closest(".tool-activity-chip");
      expect(chip).toHaveClass("tool-activity-chip--verified");
      expect(chip).toHaveClass("tool-activity-chip--done");
      expect(screen.getByText("Verified")).toBeInTheDocument();
    });

    it("does not show a verified badge for a finished tool call the backend didn't mark verified", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "Here's what I found.",
        streaming: false,
        activity: [{ tool: "web_search", label: "Searching the web", done: true, verified: false }],
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Searching the web").closest(".tool-activity-chip");
      expect(chip).not.toHaveClass("tool-activity-chip--verified");
      expect(chip).toHaveClass("tool-activity-chip--done");
      expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    });

    it("does not show a verified badge when `verified` is simply absent (a tool outside the verified allow-list)", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "Here you go.",
        streaming: false,
        activity: [{ tool: "generate_flashcards", label: "Building your flashcards", done: true }],
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Building your flashcards").closest(".tool-activity-chip");
      expect(chip).not.toHaveClass("tool-activity-chip--verified");
      expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    });

    it("never shows a verified badge on a still-running (not done) chip, even if verified were somehow set", () => {
      const message: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        activity: [{ tool: "check_student_work", label: "Checking your work", done: false, verified: true }],
      };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      const chip = screen.getByText("Checking your work").closest(".tool-activity-chip");
      expect(chip).not.toHaveClass("tool-activity-chip--verified");
      expect(chip).not.toHaveClass("tool-activity-chip--done");
      expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    });
  });
});

// Voice OUTPUT. POST /voice/synthesize (a real, Pro-gated Piper TTS service) had been
// live and working for a while with literally nothing in the app calling it — this is
// the surface that finally does. See ListenButton in MessageBubble.tsx.
describe("MessageBubble 'Listen'", () => {
  let audios: FakeAudio[] = [];

  class FakeAudio {
    paused = true;
    onended: (() => void) | null = null;
    play = vi.fn(async () => {
      this.paused = false;
    });
    pause = vi.fn(() => {
      this.paused = true;
    });

    // Real HTMLAudioElement members ListenButton touches: `currentTime` (rewound by the
    // hard stop) and `onpause` (kept in sync so the label can't claim "Pause" over
    // silence).
    currentTime = 0;
    duration = 10;
    ended = false;
    onpause: (() => void) | null = null;

    constructor(public src: string) {
      audios.push(this);
    }
  }

  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    audios = [];
    revokeObjectURL.mockClear();
    vi.mocked(synthesizeSpeech).mockReset().mockResolvedValue(new Blob(["wav-bytes"], { type: "audio/wav" }));
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:spoken"), revokeObjectURL });
  });

  function renderAssistant(overrides: Partial<ChatMessage> = {}) {
    const message: ChatMessage = { role: "assistant", content: "The Krebs cycle produces ATP.", ...overrides };
    return render(
      <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
    );
  }

  it("offers a Listen action on a finished Newton reply", () => {
    renderAssistant();
    expect(screen.getByRole("button", { name: /read this message aloud/i })).toBeInTheDocument();
  });

  it("never offers it on the student's own message", () => {
    render(
      <MessageBubble
        message={{ role: "user", content: "What is the Krebs cycle?" }}
        token="tok"
        sessionId="s1"
        onOpenSuggestedPanel={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /read this message aloud/i })).not.toBeInTheDocument();
  });

  it("never offers it mid-stream, when what it would read is still changing", () => {
    renderAssistant({ content: "The Krebs cycle", streaming: true });
    expect(screen.queryByRole("button", { name: /read this message aloud/i })).not.toBeInTheDocument();
  });

  it("never offers it on an errored or empty reply, which has nothing to read", () => {
    const { unmount } = renderAssistant({ content: "Something went wrong.", error: true });
    expect(screen.queryByRole("button", { name: /read this message aloud/i })).not.toBeInTheDocument();
    unmount();

    renderAssistant({ content: "   " });
    expect(screen.queryByRole("button", { name: /read this message aloud/i })).not.toBeInTheDocument();
  });

  it("synthesizes the message's text and plays the returned audio", async () => {
    const user = userEvent.setup();
    renderAssistant();

    await user.click(screen.getByRole("button", { name: /read this message aloud/i }));

    await waitFor(() => expect(synthesizeSpeech).toHaveBeenCalledWith("tok", "The Krebs cycle produces ATP.", expect.any(AbortSignal)));
    await waitFor(() => expect(audios).toHaveLength(1));
    expect(audios[0].src).toBe("blob:spoken");
    expect(audios[0].play).toHaveBeenCalledTimes(1);
  });

  it("reads the displayed text, not the raw attachment markers — no UUIDs read aloud", async () => {
    const user = userEvent.setup();
    render(
      <MessageBubble
        message={{ role: "assistant", content: "Here you go.\n\n[Attached document: doc-1|syllabus.pdf]" }}
        token="tok"
        sessionId="s1"
        onOpenSuggestedPanel={vi.fn()}
        onOpenDocument={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this message aloud/i }));

    await waitFor(() => expect(synthesizeSpeech).toHaveBeenCalledWith("tok", "Here you go.", expect.any(AbortSignal)));
  });

  it("shows a loading state while synthesizing, then a playing state", async () => {
    const user = userEvent.setup();
    let resolveBlob: (blob: Blob) => void = () => {};
    vi.mocked(synthesizeSpeech).mockReturnValue(
      new Promise<Blob>((resolve) => {
        resolveBlob = resolve;
      }),
    );
    renderAssistant();

    await user.click(screen.getByRole("button", { name: /read this message aloud/i }));

    // Still enabled while preparing, and labelled as a cancel: real TTS of a long reply
    // takes real server time, and the student must be able to take it back.
    const button = screen.getByRole("button", { name: /cancel preparing this message/i });
    expect(button).toHaveTextContent("Preparing… Cancel");
    expect(button).toBeEnabled();

    resolveBlob(new Blob(["wav-bytes"], { type: "audio/wav" }));
    expect(await screen.findByRole("button", { name: /pause reading this message aloud/i })).toHaveTextContent("Pause");
  });

  it("pauses on a second click and resumes on a third, without re-synthesizing", async () => {
    const user = userEvent.setup();
    renderAssistant();

    await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
    const playing = await screen.findByRole("button", { name: /pause reading this message aloud/i });

    await user.click(playing);
    expect(audios[0].pause).toHaveBeenCalled();
    expect(await screen.findByText("Resume")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /resume reading this message aloud/i }));
    await waitFor(() => expect(audios[0].play).toHaveBeenCalledTimes(2));
    // Real TTS compute isn't re-spent to replay the same words.
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(audios).toHaveLength(1);
  });

  // ─── "There is no way to stop the voice once it starts" — reported from the real
  // app. There must always be an obvious way to make it stop, including during the
  // (genuinely slow) synthesis of a long reply. ───
  describe("stopping it", () => {
    it("offers no Stop when nothing is playing or loading", () => {
      renderAssistant();
      expect(screen.queryByRole("button", { name: /stop reading this message aloud/i })).not.toBeInTheDocument();
    });

    it("offers a Stop while it is talking, which silences it and rewinds to the start", async () => {
      const user = userEvent.setup();
      renderAssistant();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      await user.click(screen.getByRole("button", { name: /stop reading this message aloud/i }));

      expect(audios[0].pause).toHaveBeenCalled();
      // Rewound, so the next Listen starts from the top rather than mid-sentence.
      expect(audios[0].currentTime).toBe(0);
      expect(await screen.findByText("Listen")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /stop reading this message aloud/i })).not.toBeInTheDocument();
    });

    it("offers a Stop while it is still being prepared, and aborts the request", async () => {
      const user = userEvent.setup();
      let capturedSignal: AbortSignal | undefined;
      vi.mocked(synthesizeSpeech).mockImplementation(
        (_t: string, _x: string, signal?: AbortSignal) =>
          new Promise<Blob>((_resolve, reject) => {
            capturedSignal = signal;
            signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      renderAssistant();

      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /cancel preparing this message/i });

      await user.click(screen.getByRole("button", { name: /stop reading this message aloud/i }));

      expect(capturedSignal?.aborted).toBe(true);
      expect(await screen.findByText("Listen")).toBeInTheDocument();
    });

    it("treats clicking the main button while preparing as a cancel, with no error shown", async () => {
      const user = userEvent.setup();
      let capturedSignal: AbortSignal | undefined;
      vi.mocked(synthesizeSpeech).mockImplementation(
        (_t: string, _x: string, signal?: AbortSignal) =>
          new Promise<Blob>((_resolve, reject) => {
            capturedSignal = signal;
            signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      renderAssistant();

      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await user.click(screen.getByRole("button", { name: /cancel preparing this message/i }));

      expect(capturedSignal?.aborted).toBe(true);
      expect(await screen.findByText("Listen")).toBeInTheDocument();
      // A cancel is what the student asked for — never surfaced as a failure.
      expect(screen.queryByText(/couldn't read that message aloud/i)).not.toBeInTheDocument();
    });

    it("passes an abort signal to the real synthesize call", async () => {
      const user = userEvent.setup();
      renderAssistant();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await waitFor(() => expect(synthesizeSpeech).toHaveBeenCalled());
      const [, , signal] = vi.mocked(synthesizeSpeech).mock.calls[0];
      expect(signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ─── "Is there any way to make it load faster? It's slow af" — reported from the real
  // app. Piper renders at ~0.12x realtime, so a long reply used to mean 15+ seconds of
  // silence before the first word, and a single 580-char request actually killed the
  // voice service. A long reply is now spoken in chunks: the first is small and starts
  // almost immediately, the rest are synthesized during playback. See lib/speech.ts. ───
  describe("long replies (chunked synthesis)", () => {
    const LONG = "Photosynthesis converts sunlight into chemical energy in plants. ".repeat(12).trim();

    function renderLong() {
      const message: ChatMessage = { role: "assistant", content: LONG };
      return render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
    }

    it("starts talking after only the FIRST chunk, not the whole reply", async () => {
      const user = userEvent.setup();
      renderLong();

      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      // Audio is already playing, and the text sent for that first request is a small
      // fraction of the reply — that difference IS the latency fix.
      expect(audios[0].play).toHaveBeenCalled();
      const firstRequestText = vi.mocked(synthesizeSpeech).mock.calls[0][1];
      expect(firstRequestText.length).toBeLessThan(LONG.length / 3);
      expect(LONG.startsWith(firstRequestText)).toBe(true);
    });

    it("never sends a request bigger than the size that took the voice service down", async () => {
      const user = userEvent.setup();
      renderLong();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await waitFor(() => expect(synthesizeSpeech).toHaveBeenCalled());

      for (const call of vi.mocked(synthesizeSpeech).mock.calls) {
        expect((call[1] as string).length).toBeLessThanOrEqual(320);
      }
    });

    it("prefetches the next chunk while the current one is still playing", async () => {
      const user = userEvent.setup();
      renderLong();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      // Two requests in flight/done while only one chunk has actually been played —
      // the second was started during playback of the first, not after it ended.
      await waitFor(() => expect(vi.mocked(synthesizeSpeech).mock.calls.length).toBeGreaterThanOrEqual(2));
      expect(audios).toHaveLength(1);
    });

    it("plays the chunks in order, continuing automatically when one ends", async () => {
      const user = userEvent.setup();
      renderLong();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      audios[0].onended?.();
      await waitFor(() => expect(audios).toHaveLength(2));
      expect(audios[1].play).toHaveBeenCalled();

      const spoken = vi.mocked(synthesizeSpeech).mock.calls.map((c) => c[1] as string);
      expect(LONG.startsWith(spoken[0])).toBe(true);
      expect(LONG).toContain(spoken[1]);
    });

    it("stops the whole queue, not just the chunk currently talking", async () => {
      const user = userEvent.setup();
      renderLong();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      await user.click(screen.getByRole("button", { name: /stop reading this message aloud/i }));
      expect(await screen.findByText("Listen")).toBeInTheDocument();

      // The chunk that was talking is silenced, and a chunk finishing later must not
      // resurrect playback behind the student's back.
      expect(audios[0].pause).toHaveBeenCalled();
      const audioCountAtStop = audios.length;
      audios[0].onended?.();
      await waitFor(() => expect(screen.getByText("Listen")).toBeInTheDocument());
      expect(audios).toHaveLength(audioCountAtStop);
    });

    // WebView2 fires `pause` immediately before `ended` (observed in the real app), so
    // the end of every chunk looks like a user pause unless it's filtered out.
    it("does not flash to 'Resume' at the seam between chunks", async () => {
      const user = userEvent.setup();
      renderLong();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      // The browser's end-of-track pause: playhead is at the end, then `ended`.
      audios[0].currentTime = audios[0].duration;
      audios[0].onpause?.();
      expect(screen.queryByText("Resume")).not.toBeInTheDocument();

      await waitFor(() => expect(audios).toHaveLength(2));
      expect(await screen.findByText("Pause")).toBeInTheDocument();
    });

    // WebView2 was observed delivering the end-of-track `pause` with NO following
    // `ended`, which stalled playback permanently after the first chunk.
    it("keeps playing when the engine sends the end-of-track pause but never 'ended'", async () => {
      const user = userEvent.setup();
      renderLong();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      audios[0].currentTime = audios[0].duration;
      audios[0].onpause?.(); // and no onended at all
      await waitFor(() => expect(audios).toHaveLength(2));
      expect(audios[1].play).toHaveBeenCalled();
    });

    it("advances only once when BOTH pause and ended arrive for the same chunk", async () => {
      const user = userEvent.setup();
      renderLong();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      audios[0].currentTime = audios[0].duration;
      audios[0].ended = true;
      audios[0].onpause?.();
      audios[0].onended?.();
      await waitFor(() => expect(audios).toHaveLength(2));
      // Not three: the latch means the same seam can't skip a chunk.
      await new Promise((r) => setTimeout(r, 50));
      expect(audios).toHaveLength(2);
    });

    it("buffers two chunks ahead so a slow download can't leave an audible gap", async () => {
      const user = userEvent.setup();
      renderLong();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      // Chunk 1 is playing; chunks 2 and 3 are already being synthesized.
      await waitFor(() => expect(vi.mocked(synthesizeSpeech).mock.calls.length).toBeGreaterThanOrEqual(3));
      expect(audios).toHaveLength(1);
    });

    it("still reports a genuine mid-playback pause (not every pause is end-of-track)", async () => {
      const user = userEvent.setup();
      renderLong();
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      // Paused halfway through — a real interruption, which must show as Resume.
      audios[0].currentTime = audios[0].duration / 2;
      audios[0].onpause?.();
      expect(await screen.findByText("Resume")).toBeInTheDocument();
    });

    it("returns to idle once the last chunk has finished", async () => {
      const user = userEvent.setup();
      const message: ChatMessage = { role: "assistant", content: "One sentence here. Two sentence here." };
      render(
        <MessageBubble message={message} token="tok" sessionId="s1" onOpenSuggestedPanel={vi.fn()} onOpenDocument={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
      await screen.findByRole("button", { name: /pause reading this message aloud/i });

      // This short reply is a single chunk, so its end is the end of the reply.
      audios[audios.length - 1].onended?.();
      expect(await screen.findByText("Listen")).toBeInTheDocument();
    });
  });

  it("returns to the idle Listen state when playback finishes on its own", async () => {
    const user = userEvent.setup();
    renderAssistant();

    await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
    await screen.findByRole("button", { name: /pause reading this message aloud/i });

    audios[0].onended?.();

    expect(await screen.findByText("Listen")).toBeInTheDocument();
  });

  it("shows the server's own upgrade message on the Pro gate, and stays usable afterwards", async () => {
    const user = userEvent.setup();
    vi.mocked(synthesizeSpeech).mockRejectedValue(
      new ApiError("Voice is a Pro feature — upgrade to Newton Pro to use transcription and playback."),
    );
    renderAssistant();

    await user.click(screen.getByRole("button", { name: /read this message aloud/i }));

    expect(await screen.findByText(/Voice is a Pro feature/)).toBeInTheDocument();
    // Not stuck in a loading state, and not a raw stack-trace-y failure.
    const button = screen.getByRole("button", { name: /read this message aloud/i });
    expect(button).toHaveTextContent("Listen");
    expect(button).not.toBeDisabled();
  });

  it("releases the audio object URL when the bubble goes away", async () => {
    const user = userEvent.setup();
    const { unmount } = renderAssistant();

    await user.click(screen.getByRole("button", { name: /read this message aloud/i }));
    await waitFor(() => expect(audios).toHaveLength(1));

    unmount();

    expect(audios[0].pause).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:spoken");
  });

  // Conversation Practice mode (turn-based spoken roleplay -- see Composer.tsx's
  // toggle/App.tsx's handleSend, app/agents/tutor.py's conversation_practice_
  // addendum): the reply is meant to be HEARD without a manual click. `conversation
  // Practice`/`ttsLanguage` on the message (set by App.tsx only for a Conversation
  // Practice send) drive ListenButton's `autoPlay`/`language` props.
  describe("Conversation Practice auto-play", () => {
    it("plays automatically, with no click, when the message is tagged conversationPractice", async () => {
      renderAssistant({ conversationPractice: true, ttsLanguage: "es" });

      await waitFor(() => expect(synthesizeSpeech).toHaveBeenCalledWith("tok", "The Krebs cycle produces ATP.", expect.any(AbortSignal), "es"));
      await waitFor(() => expect(audios).toHaveLength(1));
      expect(audios[0].play).toHaveBeenCalledTimes(1);
    });

    it("requests the matching-language voice, not the default, when auto-playing", async () => {
      renderAssistant({ conversationPractice: true, ttsLanguage: "fr" });

      await waitFor(() =>
        expect(synthesizeSpeech).toHaveBeenCalledWith("tok", "The Krebs cycle produces ATP.", expect.any(AbortSignal), "fr"),
      );
    });

    it("an ordinary reply (no conversationPractice flag) never auto-plays -- Listen stays manual", async () => {
      renderAssistant();

      // Give any stray auto-play effect a tick to (not) fire.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(synthesizeSpeech).not.toHaveBeenCalled();
      expect(audios).toHaveLength(0);
      expect(screen.getByRole("button", { name: /read this message aloud/i })).toHaveTextContent("Listen");
    });

    it("a plain manual Listen click still omits the language argument entirely (unaffected by this feature)", async () => {
      const user = userEvent.setup();
      renderAssistant(); // no conversationPractice/ttsLanguage at all

      await user.click(screen.getByRole("button", { name: /read this message aloud/i }));

      await waitFor(() =>
        expect(synthesizeSpeech).toHaveBeenCalledWith("tok", "The Krebs cycle produces ATP.", expect.any(AbortSignal)),
      );
    });

    it("the auto-played reply can still be paused/stopped manually like any other", async () => {
      const user = userEvent.setup();
      renderAssistant({ conversationPractice: true, ttsLanguage: "es" });

      await screen.findByRole("button", { name: /pause reading this message aloud/i });
      await user.click(screen.getByRole("button", { name: /pause reading this message aloud/i }));

      expect(await screen.findByRole("button", { name: /resume reading this message aloud/i })).toBeInTheDocument();
    });
  });
});
