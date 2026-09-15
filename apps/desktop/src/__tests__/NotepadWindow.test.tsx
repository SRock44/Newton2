import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotepadWindow from "../NotepadWindow";
import * as api from "../api";

const listeners: Record<string, Array<(event: { payload: unknown }) => void>> = {};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, callback: (event: { payload: unknown }) => void) => {
    (listeners[event] ??= []).push(callback);
    return Promise.resolve(() => {
      listeners[event] = (listeners[event] ?? []).filter((cb) => cb !== callback);
    });
  }),
}));

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return {
    ...actual,
    listNotes: vi.fn(),
    createNote: vi.fn(),
    getNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    annotateNoteSelection: vi.fn(),
  };
});

const listNotes = api.listNotes as ReturnType<typeof vi.fn>;
const createNote = api.createNote as ReturnType<typeof vi.fn>;
const getNote = api.getNote as ReturnType<typeof vi.fn>;
const updateNote = api.updateNote as ReturnType<typeof vi.fn>;
const annotateNoteSelection = api.annotateNoteSelection as ReturnType<typeof vi.fn>;

const NOTE_SUMMARY = { id: "n1", title: "Chemistry — Sept 15", created_at: "2026-09-15T00:00:00Z", updated_at: "2026-09-15T00:00:00Z" };

async function fireAuth(token: string | null) {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  act(() => {
    (listeners["notepad-auth"] ?? []).forEach((cb) => cb({ payload: { token } }));
  });
}

describe("NotepadWindow", () => {
  beforeEach(() => {
    listNotes.mockReset();
    createNote.mockReset();
    getNote.mockReset();
    updateNote.mockReset();
    annotateNoteSelection.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a waiting message before the main window's auth token arrives", async () => {
    render(<NotepadWindow />);
    await fireAuth(null);
    expect(screen.getByText(/waiting for the main newton window to sign in/i)).toBeInTheDocument();
  });

  it("loads and displays the note picker once authenticated", async () => {
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    render(<NotepadWindow />);
    await fireAuth("tok");

    expect(await screen.findByText("Chemistry — Sept 15")).toBeInTheDocument();
    expect(listNotes).toHaveBeenCalledWith("tok");
  });

  it("shows an empty state when there are no notes yet", async () => {
    listNotes.mockResolvedValue([]);
    render(<NotepadWindow />);
    await fireAuth("tok");

    expect(await screen.findByText(/no notes yet/i)).toBeInTheDocument();
  });

  it("creates a new note and opens it in the editor", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([]);
    createNote.mockResolvedValue({ ...NOTE_SUMMARY, id: "n2", title: "2026-09-15" });
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, id: "n2", title: "2026-09-15", content: "" });
    render(<NotepadWindow />);
    await fireAuth("tok");
    await screen.findByText(/no notes yet/i);

    await user.click(screen.getByRole("button", { name: "+ New Note" }));

    expect(await screen.findByPlaceholderText("Start writing…")).toBeInTheDocument();
    expect(createNote).toHaveBeenCalledWith("tok");
  });

  it("opening a note loads its title and content into the editor", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "Some real note content." });
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    expect(await screen.findByDisplayValue("Some real note content.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Chemistry — Sept 15")).toBeInTheDocument();
  });

  it("autosaves edited content after the debounce, then clears the local draft", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "" });
    updateNote.mockResolvedValue(NOTE_SUMMARY);
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    const textarea = await screen.findByPlaceholderText("Start writing…");
    await user.type(textarea, "New notes.");

    // A draft is written to localStorage immediately, before the debounce fires.
    expect(window.localStorage.getItem("newton:notepad:draft:n1")).toContain("New notes.");

    await vi.advanceTimersByTimeAsync(3000);

    await waitFor(() => expect(updateNote).toHaveBeenCalledWith("tok", "n1", "Chemistry — Sept 15", "New notes."));
    expect(window.localStorage.getItem("newton:notepad:draft:n1")).toBeNull();
  });

  it("restores an unsaved localStorage draft instead of the server's stale copy", async () => {
    window.localStorage.setItem(
      "newton:notepad:draft:n1",
      JSON.stringify({ title: "Chemistry — Sept 15", content: "Unsaved crash-recovered text." }),
    );
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "Stale server content." });
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    expect(await screen.findByDisplayValue("Unsaved crash-recovered text.")).toBeInTheDocument();
  });

  it("Preview mode renders the note's raw markdown through MessageContent", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "# A heading" });
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));
    await screen.findByDisplayValue("# A heading");

    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByRole("heading", { name: "A heading" })).toBeInTheDocument();
  });

  it("highlighting text in Preview mode shows the Explain/Define/Summarize toolbar, and Explain inserts a newton-note block", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "The mitochondria is the powerhouse of the cell." });
    annotateNoteSelection.mockResolvedValue("A cell organelle that produces ATP.");
    updateNote.mockResolvedValue(NOTE_SUMMARY);
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));
    await user.click(screen.getByRole("button", { name: "Preview" }));

    const paragraph = await screen.findByText(/the mitochondria is the powerhouse/i);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // jsdom doesn't compute real layout, but getBoundingClientRect exists and the
    // component only reads its numbers for positioning, not for correctness.
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ top: 100, left: 50, bottom: 120, right: 200, width: 150, height: 20 }),
    });

    await act(async () => {
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    const explainBtn = await screen.findByRole("button", { name: "Explain" });
    await user.click(explainBtn);

    await waitFor(() =>
      expect(annotateNoteSelection).toHaveBeenCalledWith(
        "tok",
        "n1",
        "The mitochondria is the powerhouse of the cell.",
        "The mitochondria is the powerhouse of the cell.",
        "explain",
      ),
    );
    expect(await screen.findByText("Newton explained")).toBeInTheDocument();
    expect(await screen.findByText("A cell organelle that produces ATP.")).toBeInTheDocument();
  });
});
