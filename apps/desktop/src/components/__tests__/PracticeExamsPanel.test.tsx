import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PracticeExamsPanel from "../PracticeExamsPanel";
import type { PracticeExamDetail, PracticeExamSummary } from "../../types";

const examSummaries: PracticeExamSummary[] = [
  {
    id: "exam-1",
    document_id: "doc-1",
    title: "physics-notes.txt",
    difficulty: "medium",
    score: null,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: null,
  },
];

const examDetail: PracticeExamDetail = {
  ...examSummaries[0],
  questions: [
    {
      id: "q-1",
      question_index: 0,
      question: "What is F=ma?",
      choices: ["Newton's first law", "Newton's second law", "Newton's third law", "Ohm's law"],
    },
  ],
};

const gradedDetail: PracticeExamDetail = {
  ...examDetail,
  score: 1,
  completed_at: "2026-01-02T00:00:00Z",
  questions: [
    {
      ...examDetail.questions[0],
      correct_index: 1,
      explanation: "F=ma is Newton's second law.",
      student_answer_index: 1,
      is_correct: true,
    },
  ],
};

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    listPracticeExams: vi.fn(async () => examSummaries),
    getPracticeExam: vi.fn(async () => examDetail),
    submitPracticeExam: vi.fn(async () => gradedDetail),
    deletePracticeExam: vi.fn(async () => undefined),
    createShareLink: vi.fn(),
    revokeShareLink: vi.fn(),
  };
});

import {
  ApiError,
  createShareLink,
  deletePracticeExam,
  getPracticeExam,
  listPracticeExams,
  revokeShareLink,
  submitPracticeExam,
} from "../../api";

describe("PracticeExamsPanel", () => {
  beforeEach(() => {
    vi.mocked(listPracticeExams).mockClear();
    vi.mocked(getPracticeExam).mockClear();
    vi.mocked(submitPracticeExam).mockClear();
    vi.mocked(deletePracticeExam).mockClear();
    vi.mocked(createShareLink).mockReset().mockResolvedValue({
      id: "link-9",
      kind: "practice_exam",
      document_id: null,
      exam_id: "exam-1",
      url: "http://127.0.0.1:58001/s/tok987",
      created_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(revokeShareLink).mockReset().mockResolvedValue(undefined);
  });

  it("lists exams with their score status", async () => {
    render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} />);
    expect(await screen.findByText("physics-notes.txt")).toBeInTheDocument();
    expect(screen.getByText(/not taken yet/i)).toBeInTheDocument();
  });

  it("shows an empty state with no exams", async () => {
    vi.mocked(listPracticeExams).mockResolvedValueOnce([]);
    render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} />);
    expect(await screen.findByText(/no practice exams yet/i)).toBeInTheDocument();
  });

  it("opening an exam shows its questions without leaking the correct answer", async () => {
    const user = userEvent.setup();
    render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} />);
    await user.click(await screen.findByText("physics-notes.txt"));

    expect(await screen.findByText(/what is f=ma\?/i)).toBeInTheDocument();
    expect(screen.getByText("Newton's second law")).toBeInTheDocument();
    // no highlighting classes / explanation shown before submission
    expect(screen.queryByText(/f=ma is newton's second law/i)).not.toBeInTheDocument();
  });

  it("selecting an answer and submitting shows the score and explanation", async () => {
    const user = userEvent.setup();
    render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} />);
    await user.click(await screen.findByText("physics-notes.txt"));
    await screen.findByText(/what is f=ma\?/i);

    await user.click(screen.getByText("Newton's second law"));
    await user.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() =>
      expect(vi.mocked(submitPracticeExam)).toHaveBeenCalledWith("test-token", "exam-1", { "q-1": 1 }),
    );
    expect(await screen.findByText("Score: 100%")).toBeInTheDocument();
    expect(screen.getByText(/f=ma is newton's second law/i)).toBeInTheDocument();
  });

  it("deleting an exam from the list removes it", async () => {
    const user = userEvent.setup();
    render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} />);
    await screen.findByText("physics-notes.txt");

    await user.click(screen.getByRole("button", { name: /delete exam: physics-notes\.txt/i }));

    await waitFor(() => expect(vi.mocked(deletePracticeExam)).toHaveBeenCalledWith("test-token", "exam-1"));
    expect(screen.queryByText("physics-notes.txt")).not.toBeInTheDocument();
  });

  it("the back button returns to the list without closing the panel", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PracticeExamsPanel token="test-token" onClose={onClose} />);
    await user.click(await screen.findByText("physics-notes.txt"));
    await screen.findByText(/what is f=ma\?/i);

    await user.click(screen.getByRole("button", { name: /back to list/i }));

    expect(await screen.findByText("physics-notes.txt")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // initialExamId — the Home dashboard's weak-areas widget's "Practice again" jumping
  // straight to the one exam holding the most of a topic's missed questions, instead of
  // leaving the student to find it themselves in the plain list.
  // ---------------------------------------------------------------------------

  describe("initialExamId (deep link from the weak-areas widget)", () => {
    it("jumps straight into the given exam once the list has loaded, with no click needed", async () => {
      render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} initialExamId="exam-1" />);

      expect(await screen.findByText(/what is f=ma\?/i)).toBeInTheDocument();
      expect(vi.mocked(getPracticeExam)).toHaveBeenCalledWith("test-token", "exam-1");
    });

    it("stays on the plain list when the given exam id isn't one of this student's exams", async () => {
      render(
        <PracticeExamsPanel token="test-token" onClose={vi.fn()} initialExamId="does-not-exist" />,
      );

      await screen.findByText("physics-notes.txt");
      expect(vi.mocked(getPracticeExam)).not.toHaveBeenCalled();
    });

    it("is unchanged, plain-list behavior when omitted (default)", async () => {
      render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} />);

      await screen.findByText("physics-notes.txt");
      expect(vi.mocked(getPracticeExam)).not.toHaveBeenCalled();
    });
  });

  describe("share link", () => {
    it("mints a public link for one exam and copies its URL", async () => {
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} />);
      await screen.findByText("physics-notes.txt");

      await user.click(screen.getByRole("button", { name: /share exam: physics-notes\.txt/i }));

      await waitFor(() =>
        expect(createShareLink).toHaveBeenCalledWith("test-token", {
          kind: "practice_exam",
          exam_id: "exam-1",
        }),
      );
      expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:58001/s/tok987");
      expect(await screen.findByText(/anyone with it can view this exam/i)).toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it("swaps to a revoke action once shared, and really revokes", async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} />);
      await screen.findByText("physics-notes.txt");

      await user.click(screen.getByRole("button", { name: /share exam: physics-notes\.txt/i }));
      const stop = await screen.findByRole("button", { name: /stop sharing exam/i });
      await user.click(stop);

      await waitFor(() => expect(revokeShareLink).toHaveBeenCalledWith("test-token", "link-9"));
      expect(await screen.findByText(/that link no longer works/i)).toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it("reports a failure rather than showing a revoke button for a link that was never made", async () => {
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      vi.mocked(createShareLink).mockRejectedValueOnce(new ApiError("Couldn't create a share link."));
      render(<PracticeExamsPanel token="test-token" onClose={vi.fn()} />);
      await screen.findByText("physics-notes.txt");

      await user.click(screen.getByRole("button", { name: /share exam: physics-notes\.txt/i }));

      expect(await screen.findByText("Couldn't create a share link.")).toBeInTheDocument();
      expect(writeText).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /stop sharing exam/i })).not.toBeInTheDocument();
      vi.restoreAllMocks();
    });
  });
});
