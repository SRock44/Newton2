import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotepadWindow from "../NotepadWindow";
import * as api from "../api";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

const listeners: Record<string, Array<(event: { payload: unknown }) => void>> = {};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, callback: (event: { payload: unknown }) => void) => {
    (listeners[event] ??= []).push(callback);
    return Promise.resolve(() => {
      listeners[event] = (listeners[event] ?? []).filter((cb) => cb !== callback);
    });
  }),
  emit: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
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
    updateNoteTags: vi.fn(),
    annotateNoteSelection: vi.fn(),
    transcribeAudio: vi.fn(),
  };
});

const listNotes = api.listNotes as ReturnType<typeof vi.fn>;
const createNote = api.createNote as ReturnType<typeof vi.fn>;
const getNote = api.getNote as ReturnType<typeof vi.fn>;
const updateNote = api.updateNote as ReturnType<typeof vi.fn>;
const deleteNote = api.deleteNote as ReturnType<typeof vi.fn>;
const updateNoteTags = api.updateNoteTags as ReturnType<typeof vi.fn>;
const annotateNoteSelection = api.annotateNoteSelection as ReturnType<typeof vi.fn>;

const NOTE_SUMMARY = {
  id: "n1",
  title: "Chemistry — Sept 15",
  created_at: "2026-09-15T00:00:00Z",
  updated_at: "2026-09-15T00:00:00Z",
  tags: [] as string[],
};

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
    deleteNote.mockReset();
    updateNoteTags.mockReset();
    annotateNoteSelection.mockReset();
    window.localStorage.clear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(emit).mockClear();
    vi.mocked(invoke).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a waiting message before the main window's auth token arrives", async () => {
    render(<NotepadWindow />);
    await fireAuth(null);
    expect(screen.getByText(/waiting for the main newton window to sign in/i)).toBeInTheDocument();
  });

  // Notepad auth race fix (ROADMAP.md "stuck on Waiting... even when signed in"): Tauri
  // events aren't queued for late listeners, so a Notepad opened well after sign-in
  // would otherwise miss the one-and-only "notepad-auth" broadcast that already
  // happened. This asserts the request half of the fix: the window asks for the current
  // token the moment its listener is ready, instead of just passively waiting.
  it("asks the main window for the current token on mount via notepad-ready", async () => {
    render(<NotepadWindow />);
    await waitFor(() => expect(vi.mocked(emit)).toHaveBeenCalledWith("notepad-ready"));
  });

  it("does not show the Sign in fallback button while the notepad-ready round trip is still in flight", async () => {
    render(<NotepadWindow />);
    await fireAuth(null); // still no token, but well within the round-trip window
    expect(screen.getByText(/waiting for the main newton window to sign in/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("shows a Sign in fallback button once the wait genuinely times out with no token, and it focuses the main window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    render(<NotepadWindow />);

    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(4_000);

    const signInButton = await screen.findByRole("button", { name: "Sign in" });
    await user.click(signInButton);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("focus_main_window");

    vi.useRealTimers();
  });

  it("never shows the Sign in fallback once a real token arrives before the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listNotes.mockResolvedValue([]);
    render(<NotepadWindow />);
    await fireAuth("tok");

    await vi.advanceTimersByTimeAsync(4_000);
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();

    vi.useRealTimers();
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

    expect(await screen.findByText("Some real note content.")).toBeInTheDocument();
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

    expect(await screen.findByText("Unsaved crash-recovered text.")).toBeInTheDocument();
    expect(screen.queryByText("Stale server content.")).not.toBeInTheDocument();
  });

  it("shows the note as rendered markdown, with no separate Write/Preview modes", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "# A heading" });
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    expect(await screen.findByRole("heading", { name: "A heading" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Write" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("clicking the rendered text edits it as raw markdown; leaving it renders it again", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "# A heading" });
    updateNote.mockResolvedValue(NOTE_SUMMARY);
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    await user.click(await screen.findByRole("heading", { name: "A heading" }));
    const field = (await screen.findByDisplayValue("# A heading")) as HTMLTextAreaElement;
    await user.type(field, "!");
    expect(field.value).toBe("# A heading!");

    await user.click(screen.getByDisplayValue("Chemistry — Sept 15"));
    expect(await screen.findByRole("heading", { name: "A heading!" })).toBeInTheDocument();
  });

  it("shows Newton's answers as cards, never as a raw ```newton-note fence", async () => {
    const user = userEvent.setup();
    const note =
      "Intro line.\n\n```newton-note\n" +
      JSON.stringify({ action: "define", text: "**LIATE** is a mnemonic." }) +
      "\n```\n\nOutro line.";
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: note });
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    expect(await screen.findByText("Newton defined")).toBeInTheDocument();
    expect(screen.getByText("LIATE").tagName).toBe("STRONG");
    expect(screen.getByText("Intro line.")).toBeInTheDocument();
    expect(screen.getByText("Outro line.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("newton-note");
    expect(document.body.textContent).not.toContain('"action"');
  });

  it("removing a Newton card leaves the student's own text intact", async () => {
    const user = userEvent.setup();
    const note =
      "Intro line.\n\n```newton-note\n" +
      JSON.stringify({ action: "explain", text: "An explanation." }) +
      "\n```\n\nOutro line.";
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: note });
    updateNote.mockResolvedValue(NOTE_SUMMARY);
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));
    await screen.findByText("An explanation.");

    await user.click(screen.getByRole("button", { name: "Remove Newton's note" }));

    expect(screen.queryByText("An explanation.")).not.toBeInTheDocument();
    expect(screen.getByText(/Intro line\./)).toBeInTheDocument();
    expect(screen.getByText(/Outro line\./)).toBeInTheDocument();
  });

  it("highlighting rendered text shows the Explain/Define/Summarize toolbar, and Explain inserts a card", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "The mitochondria is the powerhouse of the cell." });
    annotateNoteSelection.mockResolvedValue("A cell organelle that produces ATP.");
    updateNote.mockResolvedValue(NOTE_SUMMARY);
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

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

  it("highlighting text while editing shows the same toolbar, and Define inserts a card right after the selection", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "Use LIATE to choose u. Then integrate." });
    annotateNoteSelection.mockResolvedValue("A mnemonic for choosing u.");
    updateNote.mockResolvedValue(NOTE_SUMMARY);
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    await user.click(await screen.findByText("Use LIATE to choose u. Then integrate."));
    const field = (await screen.findByDisplayValue("Use LIATE to choose u. Then integrate.")) as HTMLTextAreaElement;
    field.setSelectionRange(4, 9); // "LIATE"
    await act(async () => {
      fireEvent.mouseUp(field, { clientX: 120, clientY: 90 });
    });

    await user.click(await screen.findByRole("button", { name: "Define" }));

    await waitFor(() =>
      expect(annotateNoteSelection).toHaveBeenCalledWith(
        "tok",
        "n1",
        "LIATE",
        "Use LIATE to choose u. Then integrate.",
        "define",
      ),
    );
    // the answer appears as a card, with the student's text split around it
    expect(await screen.findByText("Newton defined")).toBeInTheDocument();
    expect(screen.getByText("A mnemonic for choosing u.")).toBeInTheDocument();
    // ...and the stored markdown has the fence right after the highlighted word
    const draft = JSON.parse(window.localStorage.getItem("newton:notepad:draft:n1")!);
    expect(draft.content).toBe(
      "Use LIATE\n\n```newton-note\n" +
        JSON.stringify({ action: "define", text: "A mnemonic for choosing u." }) +
        "\n```\n to choose u. Then integrate.",
    );
  });

  it("selecting nothing while editing shows no toolbar", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "Some words." });
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    await user.click(await screen.findByText("Some words."));
    const field = (await screen.findByDisplayValue("Some words.")) as HTMLTextAreaElement;
    field.setSelectionRange(3, 3);
    await act(async () => {
      fireEvent.mouseUp(field, { clientX: 10, clientY: 10 });
    });
    expect(screen.queryByRole("button", { name: "Define" })).not.toBeInTheDocument();
  });

  it("right-clicking a note in the picker offers Rename and Delete, and Delete removes it after confirming", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    deleteNote.mockResolvedValue(undefined);
    render(<NotepadWindow />);
    await fireAuth("tok");

    const row = (await screen.findByText("Chemistry — Sept 15")).closest('[data-context-menu="note-item"]');
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row!);

    expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    const deleteItem = await screen.findByRole("menuitem", { name: "Delete" });
    await user.click(deleteItem);

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Chemistry — Sept 15"));
    await waitFor(() => expect(deleteNote).toHaveBeenCalledWith("tok", "n1"));
  });

  it("does not delete when the confirmation is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    render(<NotepadWindow />);
    await fireAuth("tok");

    const row = (await screen.findByText("Chemistry — Sept 15")).closest('[data-context-menu="note-item"]');
    fireEvent.contextMenu(row!);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(deleteNote).not.toHaveBeenCalled();
  });

  it("renaming via the context menu shows an inline input and saves the new title", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "existing body" });
    updateNote.mockResolvedValue(NOTE_SUMMARY);
    render(<NotepadWindow />);
    await fireAuth("tok");

    const row = (await screen.findByText("Chemistry — Sept 15")).closest('[data-context-menu="note-item"]');
    fireEvent.contextMenu(row!);
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByDisplayValue("Chemistry — Sept 15");
    await user.clear(input);
    await user.type(input, "Renamed note{Enter}");

    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith("tok", "n1", "Renamed note", "existing body"),
    );
  });

  it("right-clicking a selection while editing offers edit commands plus Explain/Define/Summarize", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "Mitochondria are the powerhouse of the cell." });
    annotateNoteSelection.mockResolvedValue("A cell organelle that produces ATP.");
    updateNote.mockResolvedValue(NOTE_SUMMARY);
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    await user.click(await screen.findByText(/Mitochondria are the powerhouse/));
    const textarea = (await screen.findByDisplayValue(/Mitochondria are the powerhouse/)) as HTMLTextAreaElement;
    textarea.setSelectionRange(0, "Mitochondria".length);
    fireEvent.contextMenu(textarea);

    expect(await screen.findByRole("menuitem", { name: "Cut" })).toBeInTheDocument();
    expect(await screen.findByRole("menuitem", { name: "Paste" })).toBeInTheDocument();
    const explainItem = await screen.findByRole("menuitem", { name: "Explain" });
    await user.click(explainItem);

    await waitFor(() =>
      expect(annotateNoteSelection).toHaveBeenCalledWith(
        "tok",
        "n1",
        "Mitochondria",
        "Mitochondria are the powerhouse of the cell.",
        "explain",
      ),
    );
  });

  it("right-clicking a selection in the rendered note offers Explain/Define/Summarize via the context menu", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    getNote.mockResolvedValue({ ...NOTE_SUMMARY, content: "The mitochondria is the powerhouse of the cell." });
    annotateNoteSelection.mockResolvedValue("A cell organelle that produces ATP.");
    updateNote.mockResolvedValue(NOTE_SUMMARY);
    render(<NotepadWindow />);
    await fireAuth("tok");
    await user.click(await screen.findByText("Chemistry — Sept 15"));

    const paragraph = await screen.findByText(/the mitochondria is the powerhouse/i);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.contextMenu(paragraph);

    const explainItem = await screen.findByRole("menuitem", { name: "Explain" });
    await user.click(explainItem);

    await waitFor(() =>
      expect(annotateNoteSelection).toHaveBeenCalledWith(
        "tok",
        "n1",
        "The mitochondria is the powerhouse of the cell.",
        "The mitochondria is the powerhouse of the cell.",
        "explain",
      ),
    );
  });

  it("the tag popover adds and removes tags via PATCH /notes/{id}/tags immediately", async () => {
    const user = userEvent.setup();
    listNotes.mockResolvedValue([NOTE_SUMMARY]);
    updateNoteTags.mockResolvedValueOnce({ ...NOTE_SUMMARY, tags: ["Bio 101"] });
    render(<NotepadWindow />);
    await fireAuth("tok");

    await user.click(await screen.findByRole("button", { name: /tags for chemistry/i }));
    const input = await screen.findByPlaceholderText("Add a tag…");
    await user.type(input, "Bio 101{Enter}");

    await waitFor(() => expect(updateNoteTags).toHaveBeenCalledWith("tok", "n1", ["Bio 101"]));
    expect(await screen.findByText("Bio 101")).toBeInTheDocument();

    updateNoteTags.mockResolvedValueOnce({ ...NOTE_SUMMARY, tags: [] });
    await user.click(screen.getByRole("button", { name: "Remove tag Bio 101" }));
    await waitFor(() => expect(updateNoteTags).toHaveBeenCalledWith("tok", "n1", []));
  });
});
