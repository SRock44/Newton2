import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomeView from "../HomeView";
import * as api from "../../api";
import {
  getHomeWidgetSizes,
  getHomeWidgetVisibility,
  setHomeWidgetOrder,
  setHomeWidgetSizes,
  setHomeWidgetVisibility,
} from "../../lib/homeWidgets";
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
    getWeakAreas: vi.fn(),
  };
});

const listDocuments = api.listDocuments as ReturnType<typeof vi.fn>;
const listNotes = api.listNotes as ReturnType<typeof vi.fn>;
const getDocumentContent = api.getDocumentContent as ReturnType<typeof vi.fn>;
const getNote = api.getNote as ReturnType<typeof vi.fn>;
const listStudyPlan = api.listStudyPlan as ReturnType<typeof vi.fn>;
const listFlashcards = api.listFlashcards as ReturnType<typeof vi.fn>;
const getGamificationStats = api.getGamificationStats as ReturnType<typeof vi.fn>;
const getWeakAreas = api.getWeakAreas as ReturnType<typeof vi.fn>;

// Exactly the shape GET /weak-areas returns (see services/api/app/routers/weak_areas.py
// and app/services/weak_areas.py's WeakArea): real example card fronts and real missed
// exam questions, grouped by source document, worst first.
const WEAK_AREAS = [
  {
    label: "biology-ch4.pdf",
    weak_flashcards: ["What is the Krebs cycle?"],
    missed_questions: ["What produces the most ATP?"],
    weak_flashcard_ids: ["card-krebs"],
    missed_question_ids: ["q-atp"],
    missed_question_exam_ids: ["exam-1"],
    document_id: "doc-bio",
    weak_count: 2,
  },
  {
    label: "general",
    weak_flashcards: ["What is a derivative?"],
    missed_questions: [],
    weak_flashcard_ids: ["card-deriv"],
    missed_question_ids: [],
    missed_question_exam_ids: [],
    document_id: null,
    weak_count: 1,
  },
];

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
    getWeakAreas.mockReset().mockResolvedValue(WEAK_AREAS);
    vi.mocked(invoke).mockClear();
  });

  it("renders all six widgets by default", async () => {
    render(<HomeView {...baseProps()} />);

    expect(screen.getByRole("heading", { name: "Quick actions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent documents & notes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Continue a conversation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Due soon" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What to study next" })).toBeInTheDocument();
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

  describe("layout customization (order + size)", () => {
    /** The rendered widget headings, top to bottom — the only thing that actually proves
     * an order was applied. */
    function renderedWidgetOrder(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll(".home-widget .home-widget-title")).map(
        (el) => el.textContent ?? "",
      );
    }

    it("renders the dashboard's original order for an untouched account", async () => {
      const { container } = render(<HomeView {...baseProps()} />);
      await screen.findByRole("heading", { name: "Your progress" });

      expect(renderedWidgetOrder(container)).toEqual([
        "Quick actions",
        "Recent documents & notes",
        "Continue a conversation",
        "Due soon",
        "Your progress",
        "What to study next",
      ]);
    });

    it("renders widgets in a persisted custom order", async () => {
      setHomeWidgetOrder("user-1", ["progress", "dueSoon", "weakAreas", "quickActions", "conversations", "recent"]);
      const { container } = render(<HomeView {...baseProps()} />);
      await screen.findByRole("heading", { name: "Your progress" });

      expect(renderedWidgetOrder(container)).toEqual([
        "Your progress",
        "Due soon",
        "What to study next",
        "Quick actions",
        "Continue a conversation",
        "Recent documents & notes",
      ]);
    });

    it("keeps a hidden widget out of the layout without disturbing the order of the rest", async () => {
      setHomeWidgetOrder("user-1", ["progress", "dueSoon", "weakAreas", "quickActions", "conversations", "recent"]);
      setHomeWidgetVisibility("user-1", { ...getHomeWidgetVisibility("user-1"), dueSoon: false });
      const { container } = render(<HomeView {...baseProps()} />);
      await screen.findByRole("heading", { name: "Your progress" });

      expect(renderedWidgetOrder(container)).toEqual([
        "Your progress",
        "What to study next",
        "Quick actions",
        "Continue a conversation",
        "Recent documents & notes",
      ]);
    });

    it("the Customize popover lists every widget with a drag handle, in the current order", async () => {
      const user = userEvent.setup();
      setHomeWidgetOrder("user-1", ["progress", "dueSoon", "weakAreas", "quickActions", "conversations", "recent"]);
      render(<HomeView {...baseProps()} />);

      await user.click(screen.getByRole("button", { name: /customize/i }));

      const handles = screen.getAllByRole("button", { name: /^Reorder / });
      expect(handles.map((h) => h.getAttribute("aria-label"))).toEqual([
        "Reorder Your progress",
        "Reorder Due soon",
        "Reorder What to study next",
        "Reorder Quick actions",
        "Reorder Continue a conversation",
        "Reorder Recent documents & notes",
      ]);
    });

    it("applies the default widget footprints: quick actions and recent are wide, the rest compact", async () => {
      const { container } = render(<HomeView {...baseProps()} />);
      await screen.findByRole("heading", { name: "Your progress" });

      expect(container.querySelector(".home-widget--quick-actions")).toHaveClass("home-widget--wide");
      expect(container.querySelector(".home-widget--recent")).toHaveClass("home-widget--wide");
      expect(container.querySelector(".home-widget--due-soon")).toHaveClass("home-widget--compact");
      expect(container.querySelector(".home-widget--progress")).toHaveClass("home-widget--compact");
    });

    it("toggling a widget's size switches its grid footprint and persists it", async () => {
      const user = userEvent.setup();
      const { container, unmount } = render(<HomeView {...baseProps()} />);
      await screen.findByRole("heading", { name: "Your progress" });

      await user.click(screen.getByRole("button", { name: /customize/i }));
      await user.click(screen.getByRole("button", { name: /^Your progress size:/i }));

      expect(container.querySelector(".home-widget--progress")).toHaveClass("home-widget--wide");
      expect(getHomeWidgetSizes("user-1").progress).toBe("wide");

      unmount();
      const second = render(<HomeView {...baseProps()} />);
      await screen.findByRole("heading", { name: "Your progress" });
      expect(second.container.querySelector(".home-widget--progress")).toHaveClass("home-widget--wide");
    });

    it("size, order and visibility are all scoped to the signed-in student", async () => {
      setHomeWidgetOrder("user-a", ["progress", "dueSoon", "quickActions", "conversations", "recent"]);
      setHomeWidgetSizes("user-a", { ...getHomeWidgetSizes("user-a"), progress: "wide" });

      const { container } = render(<HomeView {...baseProps({ userId: "user-b" })} />);
      await screen.findByRole("heading", { name: "Your progress" });

      expect(renderedWidgetOrder(container)[0]).toBe("Quick actions");
      expect(container.querySelector(".home-widget--progress")).toHaveClass("home-widget--compact");
    });

    it("a widget hidden from the popover still keeps its place in the order when shown again", async () => {
      const user = userEvent.setup();
      const { container } = render(<HomeView {...baseProps()} />);
      await screen.findByRole("heading", { name: "Your progress" });

      await user.click(screen.getByRole("button", { name: /customize/i }));
      await user.click(screen.getByRole("checkbox", { name: /continue a conversation/i }));
      expect(renderedWidgetOrder(container)).not.toContain("Continue a conversation");

      await user.click(screen.getByRole("checkbox", { name: /continue a conversation/i }));
      expect(renderedWidgetOrder(container)).toEqual([
        "Quick actions",
        "Recent documents & notes",
        "Continue a conversation",
        "Due soon",
        "Your progress",
        "What to study next",
      ]);
    });
  });

  // "What to study next" — the Home surface for the real per-topic weak-area analysis
  // the backend computes from actual flashcard review ratings and missed practice-exam
  // questions (GET /weak-areas). It is a full, ordinary widget, not a special case: the
  // show/hide, reorder and resize tests above already cover it via the shared lists.
  describe("What to study next", () => {
    it("shows the real weak topics with concrete example cards and missed questions", async () => {
      render(<HomeView {...baseProps()} />);

      await waitFor(() => expect(getWeakAreas).toHaveBeenCalledWith("tok"));
      expect(await screen.findByText("biology-ch4.pdf")).toBeInTheDocument();
      // Real example text, not just a count — that's the whole point of the widget.
      expect(screen.getByText("What is the Krebs cycle?")).toBeInTheDocument();
      expect(screen.getByText("What produces the most ATP?")).toBeInTheDocument();
      expect(screen.getByText("2 to revisit")).toBeInTheDocument();
    });

    it("renders the backend's 'general' bucket under a human label, not the raw key", async () => {
      render(<HomeView {...baseProps()} />);

      expect(await screen.findByText("Unfiled cards & questions")).toBeInTheDocument();
      expect(screen.queryByText("general")).not.toBeInTheDocument();
    });

    it("offers 'Review flashcards' only where there are weak cards, and 'Practice again' only where questions were missed", async () => {
      render(<HomeView {...baseProps()} />);
      await screen.findByText("biology-ch4.pdf");

      // Both topics have weak cards; only the first has missed exam questions.
      expect(screen.getAllByRole("button", { name: /review flashcards/i })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: /practice again/i })).toHaveLength(1);
    });

    it("its actions reuse the existing panel navigation rather than a new mechanism", async () => {
      const user = userEvent.setup();
      const onOpenFlashcards = vi.fn();
      const onOpenPracticeExams = vi.fn();
      render(<HomeView {...baseProps({ onOpenFlashcards, onOpenPracticeExams })} />);
      await screen.findByText("biology-ch4.pdf");

      await user.click(screen.getAllByRole("button", { name: /review flashcards/i })[0]);
      expect(onOpenFlashcards).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: /practice again/i }));
      expect(onOpenPracticeExams).toHaveBeenCalledTimes(1);
    });

    it("closes the loop: 'Review flashcards' scopes to this area's specific weak card ids", async () => {
      const user = userEvent.setup();
      const onOpenFlashcards = vi.fn();
      render(<HomeView {...baseProps({ onOpenFlashcards })} />);
      await screen.findByText("biology-ch4.pdf");

      // Two areas both offer "Review flashcards" -- clicking the FIRST one (biology-ch4.pdf)
      // must pass THAT area's card id, not the other area's or the whole deck.
      await user.click(screen.getAllByRole("button", { name: /review flashcards/i })[0]);
      expect(onOpenFlashcards).toHaveBeenCalledWith({ cardIds: ["card-krebs"] });
    });

    it("closes the loop: 'Practice again' scopes to the real exam id backing this area's missed question", async () => {
      const user = userEvent.setup();
      const onOpenPracticeExams = vi.fn();
      render(<HomeView {...baseProps({ onOpenPracticeExams })} />);
      await screen.findByText("biology-ch4.pdf");

      await user.click(screen.getByRole("button", { name: /practice again/i }));
      expect(onOpenPracticeExams).toHaveBeenCalledWith({ examId: "exam-1" });
    });

    it("'Practice again' jumps to the ONE exam holding the most of this area's missed questions, when they span several", async () => {
      const user = userEvent.setup();
      const onOpenPracticeExams = vi.fn();
      getWeakAreas.mockResolvedValue([
        {
          label: "chem-101.pdf",
          weak_flashcards: [],
          missed_questions: ["Q1", "Q2", "Q3"],
          weak_flashcard_ids: [],
          missed_question_ids: ["q1", "q2", "q3"],
          // Two questions from exam-A, one from exam-B -- exam-A has the most.
          missed_question_exam_ids: ["exam-A", "exam-B", "exam-A"],
          document_id: "doc-chem",
          weak_count: 3,
        },
      ]);
      render(<HomeView {...baseProps({ onOpenPracticeExams })} />);
      await screen.findByText("chem-101.pdf");

      await user.click(screen.getByRole("button", { name: /practice again/i }));
      expect(onOpenPracticeExams).toHaveBeenCalledWith({ examId: "exam-A" });
    });

    it("shows an honest, actionable empty state for a student with no review history yet", async () => {
      getWeakAreas.mockResolvedValue([]);
      render(<HomeView {...baseProps()} />);

      expect(await screen.findByText(/review some flashcards or take a practice exam/i)).toBeInTheDocument();
    });

    it("degrades to that same empty state (never an error) if the endpoint fails", async () => {
      getWeakAreas.mockRejectedValue(new Error("network down"));
      render(<HomeView {...baseProps()} />);

      expect(await screen.findByText(/review some flashcards or take a practice exam/i)).toBeInTheDocument();
      // The rest of the dashboard is completely unaffected.
      expect(screen.getByRole("heading", { name: "Quick actions" })).toBeInTheDocument();
    });

    it("defaults to a wide footprint so it doesn't leave two empty cells in the grid", async () => {
      const { container } = render(<HomeView {...baseProps()} />);
      await screen.findByText("biology-ch4.pdf");

      expect(container.querySelector(".home-widget--weak-areas")).toHaveClass("home-widget--wide");
    });

    it("can be hidden from Customize like any other widget, and stays hidden", async () => {
      const user = userEvent.setup();
      const { unmount } = render(<HomeView {...baseProps()} />);
      await screen.findByText("biology-ch4.pdf");

      await user.click(screen.getByRole("button", { name: /customize/i }));
      await user.click(screen.getByRole("checkbox", { name: /what to study next/i }));
      expect(screen.queryByRole("heading", { name: "What to study next" })).not.toBeInTheDocument();

      unmount();
      render(<HomeView {...baseProps()} />);
      await waitFor(() => expect(listDocuments).toHaveBeenCalled());
      expect(screen.queryByRole("heading", { name: "What to study next" })).not.toBeInTheDocument();
    });
  });
});
