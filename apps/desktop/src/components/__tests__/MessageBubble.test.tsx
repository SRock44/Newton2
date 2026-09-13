import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageBubble from "../MessageBubble";
import type { ChatMessage } from "../../types";

afterEach(() => {
  vi.unstubAllGlobals();
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
});
