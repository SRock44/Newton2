import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentsPanel from "../DocumentsPanel";
import * as api from "../../api";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return {
    ...actual,
    listDocuments: vi.fn(),
    uploadDocument: vi.fn(),
    deleteDocument: vi.fn(),
  };
});

const listDocuments = api.listDocuments as ReturnType<typeof vi.fn>;
const uploadDocument = api.uploadDocument as ReturnType<typeof vi.fn>;
const deleteDocument = api.deleteDocument as ReturnType<typeof vi.fn>;

describe("DocumentsPanel", () => {
  beforeEach(() => {
    listDocuments.mockReset();
    uploadDocument.mockReset();
    deleteDocument.mockReset();
  });

  it("loads and displays existing documents", async () => {
    listDocuments.mockResolvedValue([
      { id: "1", filename: "syllabus.pdf", mime_type: "application/pdf", created_at: "2026-01-01T00:00:00Z" },
    ]);
    render(<DocumentsPanel token="tok" onClose={() => {}} />);

    expect(await screen.findByText("syllabus.pdf")).toBeInTheDocument();
  });

  it("shows an empty state when there are no documents", async () => {
    listDocuments.mockResolvedValue([]);
    render(<DocumentsPanel token="tok" onClose={() => {}} />);

    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument();
  });

  it("uploads a chosen file and adds it to the list", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([]);
    uploadDocument.mockResolvedValue({
      id: "2",
      filename: "notes.txt",
      mime_type: "text/plain",
      created_at: "2026-01-02T00:00:00Z",
    });
    render(<DocumentsPanel token="tok" onClose={() => {}} />);
    await screen.findByText(/no documents yet/i);

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledWith("tok", file));
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
  });

  it("shows the backend's error detail when upload fails", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([]);
    uploadDocument.mockRejectedValue(new api.ApiError("File is empty"));
    render(<DocumentsPanel token="tok" onClose={() => {}} />);
    await screen.findByText(/no documents yet/i);

    const file = new File([""], "empty.txt", { type: "text/plain" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByText("File is empty")).toBeInTheDocument();
  });

  it("deletes a document when its delete button is clicked", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([
      { id: "1", filename: "syllabus.pdf", mime_type: "application/pdf", created_at: "2026-01-01T00:00:00Z" },
    ]);
    deleteDocument.mockResolvedValue(undefined);
    render(<DocumentsPanel token="tok" onClose={() => {}} />);
    await screen.findByText("syllabus.pdf");

    await user.click(screen.getByRole("button", { name: /delete syllabus.pdf/i }));

    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("tok", "1"));
    expect(screen.queryByText("syllabus.pdf")).not.toBeInTheDocument();
  });

  it("calls onClose when the overlay is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    listDocuments.mockResolvedValue([]);
    const { container } = render(<DocumentsPanel token="tok" onClose={onClose} />);
    await screen.findByText(/no documents yet/i);

    await user.click(container.querySelector(".modal-overlay") as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });
});
