import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomeView from "../HomeView";
import * as api from "../../api";
import { invoke } from "@tauri-apps/api/core";
import type { ChatSession } from "../../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return {
    ...actual,
    listDocuments: vi.fn(),
    listNotes: vi.fn(),
    getDocumentContent: vi.fn(),
    getNote: vi.fn(),
    listStudyPlan: vi.fn(),
    listFlashcards: vi.fn(),
    getGamificationStats: vi.fn(),
  };
});

const listDocuments = api.listDocuments as ReturnType<typeof vi.fn>;
const listNotes = api.listNotes as ReturnType<typeof vi.fn>;
const getDocumentContent = api.getDocumentContent as ReturnType<typeof vi.fn>;
const getNote = api.getNote as ReturnType<typeof vi.fn>;
const listStudyPlan = api.listStudyPlan as ReturnType<typeof vi.fn>;
const listFlashcards = api.listFlashcards as ReturnType<typeof vi.fn>;
const getGamificationStats = api.getGamificationStats as ReturnType<typeof vi.fn>;

const SESSIONS: ChatSession[] = [
  { id: "s1", title: "Physics review", status: "active", created_at: "2026-01-01T00:00:00Z" },
];

const DOC = { id: "doc-1", filename: "syllabus.pdf", mime_type: "application/pdf", created_at: "2026-02-01T00:00:00Z" };
const NOTE = { id: "note-1", title: "Chain rule notes", created_at: "2026-01-15T00:00:00Z", updated_at: "2026-02-05T00:00:00Z", tags: ["Calc II"] };

function baseProps(overrides: Partial<ComponentProps<typeof HomeView>> = {}) {
  return {
    token: "tok",
    userId: "user-1",
    sessions: SESSIONS,
    firstMessageBySession: {},
    onSelectSession: vi.fn(),
    onNewChat: vi.fn(),
    creatingChat: false,
    onOpenDocument: vi.fn(),
    onOpenDocuments: vi.fn(),
    onOpenStudyPlan: vi.fn(),
    onOpenFlashcards: vi.fn(),
    onOpenPracticeExams: vi.fn(),
    ...overrides,
  };
}

describe("HomeView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    listDocuments.mockReset().mockResolvedValue([DOC]);
    listNotes.mockReset().mockResolvedValue([NOTE]);
    getDocumentContent.mockReset().mockResolvedValue({ content: "This document covers projectile motion in depth.", editable: false });
    getNote.mockReset().mockResolvedValue({ ...NOTE, content: "The chain rule lets you differentiate composite functions." });
    listStudyPlan.mockReset().mockResolvedValue([
      { id: "sp-1", document_id: null, title: "Problem set 3", due_date: "2026-03-01", due_date_text: null, notes: null, source: "manual", created_at: "2026-01-01T00:00:00Z" },
    ]);
    listFlashcards.mockReset().mockResolvedValue([
      { id: "fc-1", document_id: null, front: "What is F=ma?", back: "Newton's second law", due: "2026-02-20T00:00:00Z", state: "review", last_review: null, created_at: "2026-01-01T00:00:00Z" },
    ]);
    getGamificationStats.mockReset().mockResolvedValue({
      streak_days: 4,
      xp: 120,
      level: 2,
      xp_to_next_level: 80,
      messages_sent: 30,
      flashcards_reviewed: 5,
      flashcards_created: 12,
      study_plan_items: 3,
    });
    vi.mocked(invoke).mockClear();
  });

  it("renders all five widgets by default", async () => {
    render(<HomeView {...baseProps()} />);

    expect(screen.getByRole("heading", { name: "Quick actions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent documents & notes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Continue a conversation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Due soon" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Your progress" })).toBeInTheDocument();
  });

  it("shows the recent documents & notes grid with a document and a note, including the note's tags", async () => {
    render(<HomeView {...baseProps()} />);

    expect(await screen.findByText("syllabus.pdf")).toBeInTheDocument();
    expect(await screen.findByText("Chain rule notes")).toBeInTheDocument();
    expect(await screen.findByText("Calc II")).toBeInTheDocument();
    // Snippets arrive from the bounded per-item content fetch.
    expect(await screen.findByText(/projectile motion/)).toBeInTheDocument();
    expect(await screen.findByText(/differentiate composite functions/)).toBeInTheDocument();
  });

  it("shows due soon items combining study plan and due flashcards, with due flashcards collapsed into one summary row", async () => {
    render(<HomeView {...baseProps()} />);

    expect(await screen.findByText("Problem set 3")).toBeInTheDocument();
    // A freshly-generated deck is due for its first review immediately (correct FSRS
    // behavior) — shown as one summary row, not one row per raw flashcard front, which
    // used to flood this widget with near-illegible truncated question text.
    expect(await screen.findByText("1 flashcard ready to review")).toBeInTheDocument();
    expect(screen.queryByText("What is F=ma?")).not.toBeInTheDocument();
  });

  it("shows the progress widget using the same gamification stats endpoint", async () => {
    render(<HomeView {...baseProps()} />);

    expect(await screen.findByText("🔥 4")).toBeInTheDocument();
    expect(screen.getByText("Lv 2")).toBeInTheDocument();
    expect(screen.getByText("120 XP")).toBeInTheDocument();
  });

  it("quick action 'New chat' calls the existing onNewChat callback, not a reimplementation", async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    render(<HomeView {...baseProps({ onNewChat })} />);

    await user.click(screen.getByRole("button", { name: /new chat/i }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("quick action 'Upload a document' calls the existing onOpenDocuments callback", async () => {
    const user = userEvent.setup();
    const onOpenDocuments = vi.fn();
    render(<HomeView {...baseProps({ onOpenDocuments })} />);

    await user.click(screen.getByRole("button", { name: /upload a document/i }));
    expect(onOpenDocuments).toHaveBeenCalledTimes(1);
  });

  it("quick action 'New note' opens the real Notepad window via the Tauri command", async () => {
    const user = userEvent.setup();
    render(<HomeView {...baseProps()} />);

    await user.click(screen.getByRole("button", { name: /^new note$/i }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("open_notepad_window");
  });

  it("quick action 'Start a practice session' calls the existing onOpenPracticeExams callback", async () => {
    const user = userEvent.setup();
    const onOpenPracticeExams = vi.fn();
    render(<HomeView {...baseProps({ onOpenPracticeExams })} />);

    await user.click(screen.getByRole("button", { name: /start a practice session/i }));
    expect(onOpenPracticeExams).toHaveBeenCalledTimes(1);
  });

  it("clicking a recent document card opens it via the existing onOpenDocument navigation", async () => {
    const user = userEvent.setup();
    const onOpenDocument = vi.fn();
    render(<HomeView {...baseProps({ onOpenDocument })} />);

    await user.click(await screen.findByText("syllabus.pdf"));
    expect(onOpenDocument).toHaveBeenCalledWith("doc-1");
  });

  it("clicking a 'Continue a conversation' item calls the existing onSelectSession callback", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    render(<HomeView {...baseProps({ onSelectSession })} />);

    await user.click(await screen.findByText("Physics review"));
    expect(onSelectSession).toHaveBeenCalledWith("s1");
  });

  it("clicking a 'Due soon' study plan item opens the existing Study Plan panel", async () => {
    const user = userEvent.setup();
    const onOpenStudyPlan = vi.fn();
    render(<HomeView {...baseProps({ onOpenStudyPlan })} />);

    await user.click(await screen.findByText("Problem set 3"));
    expect(onOpenStudyPlan).toHaveBeenCalledTimes(1);
  });

  it("clicking a 'Due soon' flashcard item opens the existing Flashcards panel", async () => {
    const user = userEvent.setup();
    const onOpenFlashcards = vi.fn();
    render(<HomeView {...baseProps({ onOpenFlashcards })} />);

    await user.click(await screen.findByText("1 flashcard ready to review"));
    expect(onOpenFlashcards).toHaveBeenCalledTimes(1);
  });

  it("hides a widget via Customize and keeps it hidden across a remount (persisted per user)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<HomeView {...baseProps()} />);

    await user.click(screen.getByRole("button", { name: /customize/i }));
    await user.click(screen.getByRole("checkbox", { name: /due soon/i }));

    expect(screen.queryByRole("heading", { name: "Due soon" })).not.toBeInTheDocument();

    unmount();
    render(<HomeView {...baseProps()} />);

    await waitFor(() => expect(listDocuments).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Due soon" })).not.toBeInTheDocument();
    // The other widgets are unaffected.
    expect(screen.getByRole("heading", { name: "Quick actions" })).toBeInTheDocument();
  });

  it("a different user id gets its own independent widget visibility", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<HomeView {...baseProps({ userId: "user-a" })} />);
    await user.click(screen.getByRole("button", { name: /customize/i }));
    await user.click(screen.getByRole("checkbox", { name: /due soon/i }));
    expect(screen.queryByRole("heading", { name: "Due soon" })).not.toBeInTheDocument();
    unmount();

    render(<HomeView {...baseProps({ userId: "user-b" })} />);
    expect(screen.getByRole("heading", { name: "Due soon" })).toBeInTheDocument();
  });
});
