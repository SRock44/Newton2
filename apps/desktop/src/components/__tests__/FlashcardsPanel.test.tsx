import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import FlashcardsPanel from "../FlashcardsPanel";
import type { Flashcard } from "../../types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));

const saveDialog = save as unknown as ReturnType<typeof vi.fn>;
const writeFileMock = writeFile as unknown as ReturnType<typeof vi.fn>;

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
    createShareLink: vi.fn(),
    revokeShareLink: vi.fn(),
  };
});

import {
  ApiError,
  createShareLink,
  deleteFlashcard,
  listFlashcards,
  reviewFlashcard,
  revokeShareLink,
} from "../../api";

// A stand-in for App.tsx's `() => tokenManager.getValidAccessToken()` — always resolves
// to "test-token" but, crucially, IS an async fetch of the token rather than a plain
// cached string, exactly like the real prop.
const getAccessToken = async () => "test-token";

describe("FlashcardsPanel", () => {
  beforeEach(() => {
    // Restore the default implementation every test, not just clear call history — a
    // couple of tests below override it (mockImplementation/mockRejectedValueOnce) to
    // exercise empty/error states, and that override must never leak into a later test.
    vi.mocked(listFlashcards).mockReset();
    vi.mocked(listFlashcards).mockImplementation(async (_token: string, dueOnly?: boolean) =>
      dueOnly ? dueCards : allCards,
    );
    vi.mocked(reviewFlashcard).mockClear();
    vi.mocked(deleteFlashcard).mockClear();
    saveDialog.mockReset();
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
    vi.mocked(createShareLink).mockReset().mockResolvedValue({
      id: "link-1",
      kind: "flashcards",
      document_id: null,
      exam_id: null,
      url: "http://127.0.0.1:58001/s/abc123",
      created_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(revokeShareLink).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the front of the first due card, then the back on click, then rating buttons", async () => {
    const user = userEvent.setup();
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);

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
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);

    await screen.findByText("What is FSRS?");
    await user.click(screen.getByText("What is FSRS?"));
    await user.click(await screen.findByRole("button", { name: /^good$/i }));

    await waitFor(() => expect(vi.mocked(reviewFlashcard)).toHaveBeenCalledWith("test-token", "card-1", 3));
    expect(await screen.findByText("What does ATP stand for?")).toBeInTheDocument();
  });

  it("shows an all-caught-up message once the due queue is empty", async () => {
    const user = userEvent.setup();
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);

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
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
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
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);

    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  // Regression test for the reported "generate flashcards via chat, then open
  // Flashcards, it says there are none" bug: this panel must always fetch with a
  // freshly-verified token (App.tsx's tokenManager.getValidAccessToken(), which
  // transparently refreshes first if the cached token has gone stale) rather than a
  // plain string that could have quietly expired while this panel was closed — the
  // exact class of race the WS chat connection was already fixed to avoid. Simulates a
  // token that was stale at the moment the panel opened but comes back fresh once
  // resolved, and asserts the real, current cards still load correctly.
  it("fetches with a freshly-resolved token even if that resolution involves a refresh", async () => {
    let resolveToken: (token: string) => void;
    const staleThenFreshToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveToken = resolve;
        }),
    );

    render(<FlashcardsPanel getAccessToken={staleThenFreshToken} onClose={vi.fn()} />);

    // Nothing has resolved yet — the panel must wait for the real token, not race ahead
    // with something stale or cached.
    expect(vi.mocked(listFlashcards)).not.toHaveBeenCalled();

    resolveToken!("freshly-refreshed-token");

    expect(await screen.findByText("What is FSRS?")).toBeInTheDocument();
    expect(vi.mocked(listFlashcards)).toHaveBeenCalledWith("freshly-refreshed-token", true);
  });

  // A failed fetch (expired token, dropped connection, whatever) must never be
  // rendered as "you have zero flashcards" — those mean very different things to a
  // student, and conflating them is exactly what made the original bug look like
  // missing data instead of a loading failure.
  it("distinguishes a failed fetch from a genuinely empty due queue", async () => {
    vi.mocked(listFlashcards).mockRejectedValueOnce(new Error("network blip"));
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);

    expect(await screen.findByText(/couldn't check for due flashcards/i)).toBeInTheDocument();
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Anki export — the cards leaving the app as a real .apkg.
  // ---------------------------------------------------------------------------

  it("exports every card as a real .apkg through the native save dialog", async () => {
    const user = userEvent.setup();
    // A real .apkg is a zip; "PK\x03\x04" is the zip magic number, and the 0x00/0xFF
    // bytes here would be destroyed by any text round-trip.
    const apkg = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x14]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(apkg.slice().buffer as ArrayBuffer, { status: 200 }));
    saveDialog.mockResolvedValue("C:\\Users\\student\\Downloads\\newton-flashcards.apkg");
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
    await screen.findByText("What is FSRS?");

    await user.click(screen.getByRole("button", { name: /export to anki/i }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/flashcards/export.apkg"), {
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: "newton-flashcards.apkg",
      filters: [{ name: "Anki deck", extensions: ["apkg"] }],
    });
    await waitFor(() => expect(writeFileMock).toHaveBeenCalled());
    expect(Array.from(writeFileMock.mock.calls[0][1] as Uint8Array)).toEqual(Array.from(apkg));
    expect(
      await screen.findByText(/saved to c:\\users\\student\\downloads\\newton-flashcards\.apkg/i),
    ).toBeInTheDocument();
  });

  it("is reachable straight from the panel toolbar, not from inside a card", async () => {
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
    await screen.findByText("What is FSRS?");

    const button = screen.getByRole("button", { name: /export to anki/i });
    expect(button).toBeInTheDocument();
    // Sits on the same row as the Review / All cards tabs.
    expect(button.closest(".flashcards-tabs")).not.toBeNull();
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2]), { status: 200 }));
    saveDialog.mockResolvedValue(null);
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
    await screen.findByText("What is FSRS?");

    await user.click(screen.getByRole("button", { name: /export to anki/i }));

    await waitFor(() => expect(saveDialog).toHaveBeenCalled());
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/saved to/i)).not.toBeInTheDocument();
  });

  it("reports an export failure instead of silently doing nothing", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no cards", { status: 404 }));
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
    await screen.findByText("What is FSRS?");

    await user.click(screen.getByRole("button", { name: /export to anki/i }));

    expect(await screen.findByText(/couldn't export your flashcards/i)).toBeInTheDocument();
    expect(saveDialog).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // PowerPoint export — the same cards leaving the app as a real .pptx slide deck.
  // ---------------------------------------------------------------------------

  it("exports every card as a real .pptx through the native save dialog", async () => {
    const user = userEvent.setup();
    // A .pptx is an OOXML zip, same as the .apkg above — same zip magic, same
    // binary-hostile bytes that no text round-trip would survive.
    const pptx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xfe, 0x21]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(pptx.slice().buffer as ArrayBuffer, { status: 200 }));
    saveDialog.mockResolvedValue("C:\\Users\\student\\Downloads\\newton-flashcards.pptx");
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
    await screen.findByText("What is FSRS?");

    await user.click(screen.getByRole("button", { name: /export to powerpoint/i }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/flashcards/export.pptx"), {
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: "newton-flashcards.pptx",
      filters: [{ name: "PowerPoint presentation", extensions: ["pptx"] }],
    });
    await waitFor(() => expect(writeFileMock).toHaveBeenCalled());
    expect(Array.from(writeFileMock.mock.calls[0][1] as Uint8Array)).toEqual(Array.from(pptx));
    expect(
      await screen.findByText(/saved to c:\\users\\student\\downloads\\newton-flashcards\.pptx/i),
    ).toBeInTheDocument();
  });

  it("sits on the toolbar row beside Export to Anki, with the same alignment class", async () => {
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
    await screen.findByText("What is FSRS?");

    const button = screen.getByRole("button", { name: /export to powerpoint/i });
    expect(button.closest(".flashcards-tabs")).not.toBeNull();
    // The class that baseline-aligns a toolbar action against the taller tab buttons —
    // omitting it is exactly the misalignment bug this row already had once.
    expect(button).toHaveClass("flashcards-toolbar-btn");
    // ...but NOT --first: only the leftmost action claims the row's leftover space, or
    // the right-hand cluster splits apart.
    expect(button).not.toHaveClass("flashcards-toolbar-btn--first");
  });

  it("shows a busy label only on the export that is actually running", async () => {
    const user = userEvent.setup();
    let release: (value: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
    await screen.findByText("What is FSRS?");

    await user.click(screen.getByRole("button", { name: /export to powerpoint/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /exporting/i })).toBeDisabled());
    // The Anki button is disabled meanwhile, but still says what it does.
    const anki = screen.getByRole("button", { name: /export to anki/i });
    expect(anki).toBeDisabled();
    release(new Response(new Uint8Array([1, 2]), { status: 200 }));
  });

  describe("share link", () => {
    it("mints a public link and copies its URL to the clipboard", async () => {
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
      await screen.findByText("What is FSRS?");

      await user.click(screen.getByRole("button", { name: "Share" }));

      await waitFor(() =>
        expect(createShareLink).toHaveBeenCalledWith("test-token", { kind: "flashcards" }),
      );
      // The copied value is a plain http(s) URL pointing at the API — whoever receives it
      // has no desktop app, so it must never be an app deep link.
      expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:58001/s/abc123");
      expect(await screen.findByText(/anyone with it can view these cards/i)).toBeInTheDocument();
    });

    it("offers revocation once a link exists, and really revokes it", async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
      await screen.findByText("What is FSRS?");

      expect(screen.queryByRole("button", { name: /stop sharing/i })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Share" }));

      const stop = await screen.findByRole("button", { name: /stop sharing/i });
      await user.click(stop);

      await waitFor(() => expect(revokeShareLink).toHaveBeenCalledWith("test-token", "link-1"));
      expect(await screen.findByText(/that link no longer works/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    });

    it("reports a failure to mint a link instead of pretending it copied one", async () => {
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      vi.mocked(createShareLink).mockRejectedValueOnce(new ApiError("Couldn't create a share link."));
      render(<FlashcardsPanel getAccessToken={getAccessToken} onClose={vi.fn()} />);
      await screen.findByText("What is FSRS?");

      await user.click(screen.getByRole("button", { name: "Share" }));

      expect(await screen.findByText("Couldn't create a share link.")).toBeInTheDocument();
      expect(writeText).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /stop sharing/i })).not.toBeInTheDocument();
    });
  });
});
