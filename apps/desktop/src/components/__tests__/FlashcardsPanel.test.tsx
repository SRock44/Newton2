import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FlashcardsPanel from "../FlashcardsPanel";
import type { Flashcard } from "../../types";

const dueCards: Flashcard[] = [
  {
    id: "card-1",
    document_id: "doc-1",
    front: "What is FSRS?",
    back: "Free Spaced Repetition Scheduler",
    due: "2026-01-01T00:00:00Z",
    state: "learning",
    last_review: null,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "card-2",
    document_id: "doc-1",
    front: "What does ATP stand for?",
    back: "Adenosine triphosphate",
    due: "2026-01-01T00:00:00Z",
    state: "learning",
    last_review: null,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const allCards: Flashcard[] = [
  ...dueCards,
  {
    id: "card-3",
    document_id: "doc-1",
    front: "Not due yet",
    back: "Some answer",
    due: "2099-01-01T00:00:00Z",
    state: "review",
    last_review: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
  },
];

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    listFlashcards: vi.fn(async (_token: string, dueOnly?: boolean) => (dueOnly ? dueCards : allCards)),
    reviewFlashcard: vi.fn(async (_token: string, cardId: string) => dueCards.find((c) => c.id === cardId)!),
    deleteFlashcard: vi.fn(async () => undefined),
  };
});

import { deleteFlashcard, listFlashcards, reviewFlashcard } from "../../api";

describe("FlashcardsPanel", () => {
  beforeEach(() => {
    vi.mocked(listFlashcards).mockClear();
    vi.mocked(reviewFlashcard).mockClear();
    vi.mocked(deleteFlashcard).mockClear();
  });

  it("shows the front of the first due card, then the back on click, then rating buttons", async () => {
    const user = userEvent.setup();
    render(<FlashcardsPanel token="test-token" onClose={vi.fn()} />);

    expect(await screen.findByText("What is FSRS?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^good$/i })).not.toBeInTheDocument();

    await user.click(screen.getByText("What is FSRS?"));

    expect(await screen.findByText("Free Spaced Repetition Scheduler")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^again$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^hard$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^good$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^easy$/i })).toBeInTheDocument();
  });

  it("rating a card submits the review and advances to the next one", async () => {
    const user = userEvent.setup();
    render(<FlashcardsPanel token="test-token" onClose={vi.fn()} />);

    await screen.findByText("What is FSRS?");
    await user.click(screen.getByText("What is FSRS?"));
    await user.click(await screen.findByRole("button", { name: /^good$/i }));

    await waitFor(() => expect(vi.mocked(reviewFlashcard)).toHaveBeenCalledWith("test-token", "card-1", 3));
    expect(await screen.findByText("What does ATP stand for?")).toBeInTheDocument();
  });

  it("shows an all-caught-up message once the due queue is empty", async () => {
    const user = userEvent.setup();
    render(<FlashcardsPanel token="test-token" onClose={vi.fn()} />);

    await screen.findByText("What is FSRS?");
    await user.click(screen.getByText("What is FSRS?"));
    await user.click(await screen.findByRole("button", { name: /^good$/i }));

    await screen.findByText("What does ATP stand for?");
    await user.click(screen.getByText("What does ATP stand for?"));
    await user.click(await screen.findByRole("button", { name: /^good$/i }));

    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  it("the All cards tab lists every card regardless of due date, and delete removes it", async () => {
    const user = userEvent.setup();
    render(<FlashcardsPanel token="test-token" onClose={vi.fn()} />);
    await screen.findByText("What is FSRS?");

    await user.click(screen.getByRole("button", { name: /all cards/i }));

    expect(await screen.findByText("Not due yet")).toBeInTheDocument();
    expect(screen.getByText("What is FSRS?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete flashcard: not due yet/i }));

    await waitFor(() => expect(vi.mocked(deleteFlashcard)).toHaveBeenCalledWith("test-token", "card-3"));
    expect(screen.queryByText("Not due yet")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no due cards", async () => {
    vi.mocked(listFlashcards).mockImplementation(async () => []);
    render(<FlashcardsPanel token="test-token" onClose={vi.fn()} />);

    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });
});
