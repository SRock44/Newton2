import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AttachedDocumentChip from "../AttachedDocumentChip";

describe("AttachedDocumentChip", () => {
  it("renders as a real card: a type badge, the filename, and the type", () => {
    render(<AttachedDocumentChip documentId="doc-1" filename="Research Paper.pdf" onOpen={vi.fn()} />);
    expect(screen.getByText("Research Paper.pdf")).toBeInTheDocument();
    // The badge shows the inferred type, and the type line names it again alongside the hint.
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText(/PDF — click to open/)).toBeInTheDocument();
  });

  it("infers the type from the filename extension for a non-PDF document", () => {
    render(<AttachedDocumentChip documentId="doc-2" filename="Notes.md" onOpen={vi.fn()} />);
    expect(screen.getByText("MD")).toBeInTheDocument();
    expect(screen.getByText(/MD — click to open/)).toBeInTheDocument();
  });

  it("calls onOpen with the document id and filename when clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<AttachedDocumentChip documentId="doc-1" filename="paper.pdf" onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: /paper.pdf/i }));
    expect(onOpen).toHaveBeenCalledWith("doc-1", "paper.pdf");
  });

  it("is not active by default: says Open, not pressed", () => {
    render(<AttachedDocumentChip documentId="doc-1" filename="paper.pdf" onOpen={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "Open paper.pdf");
    expect(button.className).not.toMatch(/--active/);
  });

  it("renders as active (and offers to close) when it's the document currently open", () => {
    render(<AttachedDocumentChip documentId="doc-1" filename="paper.pdf" onOpen={vi.fn()} active />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "Close paper.pdf");
    expect(button.className).toMatch(/attached-document-chip--active/);
    expect(screen.getByText(/click to close/i)).toBeInTheDocument();
  });
});
