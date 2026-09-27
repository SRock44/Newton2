import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudyItemCard from "../StudyItemCard";
import MessageBubble from "../MessageBubble";
import type { ChatMessage } from "../../types";

describe("StudyItemCard", () => {
  it.each([
    ["exam", "EXAM", "Practice exam · 15 questions — click to open"],
    ["flashcards", "CARDS", "Flashcards · 15 cards — click to open"],
    ["plan", "PLAN", "Study plan · 7 items — click to open"],
  ] as const)("renders a %s as a card with its badge, title and count", (kind, badge, line) => {
    render(<StudyItemCard kind={kind} title="Packet.docx" detail={line.split(" · ")[1]!.split(" — ")[0]!} onOpen={vi.fn()} />);
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.getByText("Packet.docx")).toBeInTheDocument();
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it("calls onOpen when clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<StudyItemCard kind="exam" title="Packet.docx" detail="15 questions" onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: /packet\.docx/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

const REPLY = [
  "Your study session is ready.",
  "",
  "[Study item: plan|doc-1|Packet.docx|7 items]",
  "[Study item: flashcards|doc-1|Packet.docx|15 cards]",
  "[Study item: exam|exam-9|Packet.docx|15 questions]",
].join("\n");

function renderBubble(overrides: Partial<ChatMessage> = {}, onOpenStudyItem = vi.fn(), onOpenSuggestedPanel = vi.fn()) {
  const message: ChatMessage = { role: "assistant", content: REPLY, ...overrides };
  render(
    <MessageBubble
      message={message}
      token="tok"
      sessionId="s1"
      onOpenSuggestedPanel={onOpenSuggestedPanel}
      onOpenDocument={vi.fn()}
      onOpenStudyItem={onOpenStudyItem}
    />,
  );
  return { onOpenStudyItem, onOpenSuggestedPanel };
}

describe("MessageBubble study cards", () => {
  it("strips the markers from the visible text and renders a card for each item", () => {
    renderBubble();
    expect(screen.queryByText(/Study item:/)).not.toBeInTheDocument();
    expect(screen.getByText("Your study session is ready.")).toBeInTheDocument();
    expect(screen.getByText("PLAN")).toBeInTheDocument();
    expect(screen.getByText("CARDS")).toBeInTheDocument();
    expect(screen.getByText("EXAM")).toBeInTheDocument();
  });

  it("puts the cards BELOW the reply text, like a document card", () => {
    renderBubble();
    const text = screen.getByText("Your study session is ready.");
    const exam = screen.getByRole("button", { name: /practice exam/i });
    // eslint-disable-next-line no-bitwise
    expect(text.compareDocumentPosition(exam) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicking a card hands its kind, id, title and detail to onOpenStudyItem", async () => {
    const user = userEvent.setup();
    const { onOpenStudyItem } = renderBubble();
    await user.click(screen.getByRole("button", { name: /practice exam/i }));
    expect(onOpenStudyItem).toHaveBeenCalledWith({ kind: "exam", id: "exam-9", title: "Packet.docx", detail: "15 questions" });
  });

  it("hides a suggested-action button that a card already covers, but keeps the others", () => {
    renderBubble({
      suggestedActions: [
        { panel: "flashcards", label: "Open Flashcards" },
        { panel: "documents", label: "Open Documents" },
      ],
    });
    expect(screen.queryByRole("button", { name: /open flashcards/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open documents/i })).toBeInTheDocument();
  });

  it("still shows a suggested-action button when there is no matching card", () => {
    renderBubble({ content: "Here you go.", suggestedActions: [{ panel: "flashcards", label: "Open Flashcards" }] });
    expect(screen.getByRole("button", { name: /open flashcards/i })).toBeInTheDocument();
  });
});
