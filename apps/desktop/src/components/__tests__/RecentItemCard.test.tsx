import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecentItemCard from "../RecentItemCard";

describe("RecentItemCard", () => {
  it("renders a document: type badge, title, date, and snippet — no tags", () => {
    render(
      <RecentItemCard
        typeLabel="PDF"
        title="syllabus.pdf"
        timestamp="2026-02-01T00:00:00Z"
        snippet="Course policies and grading breakdown."
        onClick={() => {}}
      />,
    );

    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("syllabus.pdf")).toBeInTheDocument();
    expect(screen.getByText("Course policies and grading breakdown.")).toBeInTheDocument();
    expect(screen.queryByText("Calc II")).not.toBeInTheDocument();
  });

  it("renders a note: title, snippet, and its tags", () => {
    render(
      <RecentItemCard
        typeLabel="NOTE"
        title="Chain rule notes"
        timestamp="2026-02-05T00:00:00Z"
        snippet="Differentiate the outer function times the inner derivative."
        tags={["Calc II", "Exam prep"]}
        onClick={() => {}}
      />,
    );

    expect(screen.getByText("Chain rule notes")).toBeInTheDocument();
    expect(screen.getByText(/Differentiate the outer function/)).toBeInTheDocument();
    expect(screen.getByText("Calc II")).toBeInTheDocument();
    expect(screen.getByText("Exam prep")).toBeInTheDocument();
  });

  it("calls onClick when activated", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<RecentItemCard typeLabel="TXT" title="notes.txt" timestamp="2026-01-01T00:00:00Z" onClick={onClick} />);

    await user.click(screen.getByText("notes.txt"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("marks the active item distinctly", () => {
    render(<RecentItemCard typeLabel="TXT" title="notes.txt" timestamp="2026-01-01T00:00:00Z" active onClick={() => {}} />);

    expect(screen.getByRole("button", { name: /notes\.txt/ })).toHaveClass("recent-item-card--active");
  });

  it("the row variant omits the snippet (compact list rows don't show one)", () => {
    render(
      <RecentItemCard
        variant="row"
        typeLabel="PDF"
        title="syllabus.pdf"
        timestamp="2026-02-01T00:00:00Z"
        snippet="Should not render in row mode."
        onClick={() => {}}
      />,
    );

    expect(screen.queryByText("Should not render in row mode.")).not.toBeInTheDocument();
  });
});
