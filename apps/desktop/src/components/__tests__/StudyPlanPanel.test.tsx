import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudyPlanPanel from "../StudyPlanPanel";
import * as api from "../../api";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return { ...actual, listStudyPlan: vi.fn(), deleteStudyPlanItem: vi.fn() };
});

const listStudyPlan = api.listStudyPlan as ReturnType<typeof vi.fn>;
const deleteStudyPlanItem = api.deleteStudyPlanItem as ReturnType<typeof vi.fn>;

describe("StudyPlanPanel", () => {
  beforeEach(() => {
    listStudyPlan.mockReset();
    deleteStudyPlanItem.mockReset();
  });

  it("shows an empty state pointing at Documents when there's nothing yet", async () => {
    listStudyPlan.mockResolvedValue([]);
    render(<StudyPlanPanel token="tok" onClose={() => {}} />);

    expect(await screen.findByText(/no study plan items yet/i)).toBeInTheDocument();
  });

  it("lists items with a real due date formatted, and notes shown", async () => {
    listStudyPlan.mockResolvedValue([
      {
        id: "1",
        document_id: "d1",
        title: "Problem Set 1",
        due_date: "2026-09-20",
        due_date_text: "Sept 20",
        notes: "10% of grade",
        source: "syllabus_upload",
        created_at: "2026-09-01T00:00:00Z",
      },
    ]);
    render(<StudyPlanPanel token="tok" onClose={() => {}} />);

    expect(await screen.findByText("Problem Set 1")).toBeInTheDocument();
    expect(screen.getByText("Sep 20")).toBeInTheDocument();
    expect(screen.getByText("10% of grade")).toBeInTheDocument();
  });

  it("falls back to due_date_text when there's no exact calendar date", async () => {
    listStudyPlan.mockResolvedValue([
      {
        id: "2",
        document_id: "d1",
        title: "Reading Response",
        due_date: null,
        due_date_text: "Week 3",
        notes: null,
        source: "syllabus_upload",
        created_at: "2026-09-01T00:00:00Z",
      },
    ]);
    render(<StudyPlanPanel token="tok" onClose={() => {}} />);

    expect(await screen.findByText("Reading Response")).toBeInTheDocument();
    expect(screen.getByText("Week 3")).toBeInTheDocument();
  });

  it("removes an item when its remove button is clicked", async () => {
    const user = userEvent.setup();
    listStudyPlan.mockResolvedValue([
      {
        id: "1",
        document_id: "d1",
        title: "Problem Set 1",
        due_date: "2026-09-20",
        due_date_text: "Sept 20",
        notes: null,
        source: "syllabus_upload",
        created_at: "2026-09-01T00:00:00Z",
      },
    ]);
    deleteStudyPlanItem.mockResolvedValue(undefined);
    render(<StudyPlanPanel token="tok" onClose={() => {}} />);
    await screen.findByText("Problem Set 1");

    await user.click(screen.getByRole("button", { name: /remove problem set 1/i }));

    await waitFor(() => expect(deleteStudyPlanItem).toHaveBeenCalledWith("tok", "1"));
    expect(screen.queryByText("Problem Set 1")).not.toBeInTheDocument();
  });
});
