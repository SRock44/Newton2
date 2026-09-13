import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    generateStudyPlan: vi.fn(),
    getDocumentContent: vi.fn(),
    updateDocumentContent: vi.fn(),
    renameDocument: vi.fn(),
  };
});

const listDocuments = api.listDocuments as ReturnType<typeof vi.fn>;
const uploadDocument = api.uploadDocument as ReturnType<typeof vi.fn>;
const deleteDocument = api.deleteDocument as ReturnType<typeof vi.fn>;
const generateStudyPlan = api.generateStudyPlan as ReturnType<typeof vi.fn>;
const getDocumentContent = api.getDocumentContent as ReturnType<typeof vi.fn>;
const updateDocumentContent = api.updateDocumentContent as ReturnType<typeof vi.fn>;
const renameDocument = api.renameDocument as ReturnType<typeof vi.fn>;

const SYLLABUS = { id: "1", filename: "syllabus.pdf", mime_type: "application/pdf", created_at: "2026-01-01T00:00:00Z" };
const NOTES = { id: "1", filename: "notes.txt", mime_type: "text/plain", created_at: "2026-01-01T00:00:00Z" };

describe("DocumentsPanel", () => {
  beforeEach(() => {
    listDocuments.mockReset();
    uploadDocument.mockReset();
    deleteDocument.mockReset();
    generateStudyPlan.mockReset();
    getDocumentContent.mockReset();
    updateDocumentContent.mockReset();
    renameDocument.mockReset();
    getDocumentContent.mockResolvedValue({ content: "", editable: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["pdf bytes"])));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads and displays existing documents", async () => {
    listDocuments.mockResolvedValue([SYLLABUS]);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);

    expect(await screen.findByText("syllabus.pdf")).toBeInTheDocument();
  });

  it("shows an empty state when there are no documents", async () => {
    listDocuments.mockResolvedValue([]);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);

    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument();
  });

  it("uploads a chosen file and adds it to the list", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([]);
    uploadDocument.mockResolvedValue(NOTES);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
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
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await screen.findByText(/no documents yet/i);

    const file = new File([""], "empty.txt", { type: "text/plain" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByText("File is empty")).toBeInTheDocument();
  });

  it("selecting a document loads its content and offers document actions", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([NOTES]);
    getDocumentContent.mockResolvedValue({ content: "Hello from the document.", editable: true });
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("notes.txt"));

    expect(await screen.findByText("Hello from the document.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /chat about this document/i })).toBeInTheDocument();
  });

  it("deletes the selected document when Delete is clicked", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    deleteDocument.mockResolvedValue(undefined);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("syllabus.pdf"));

    await user.click(await screen.findByRole("button", { name: /delete syllabus.pdf/i }));

    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("tok", "1"));
    expect(screen.queryByText("syllabus.pdf")).not.toBeInTheDocument();
  });

  it("calls onClose when the overlay is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    listDocuments.mockResolvedValue([]);
    const { container } = render(<DocumentsPanel token="tok" onClose={onClose} onChatAboutDocument={() => {}} />);
    await screen.findByText(/no documents yet/i);

    await user.click(container.querySelector(".modal-overlay") as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("generates a study plan and shows how many items were added", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    generateStudyPlan.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("syllabus.pdf"));

    await user.click(await screen.findByRole("button", { name: /study plan/i }));

    expect(generateStudyPlan).toHaveBeenCalledWith("tok", "1");
    expect(await screen.findByText(/added 2 items/i)).toBeInTheDocument();
  });

  it("shows a clear message when no items were found", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    generateStudyPlan.mockResolvedValue([]);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("syllabus.pdf"));

    await user.click(await screen.findByRole("button", { name: /study plan/i }));

    expect(await screen.findByText(/no gradable items found/i)).toBeInTheDocument();
  });

  it("edits and saves an editable document's content", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([NOTES]);
    getDocumentContent.mockResolvedValue({ content: "Original text.", editable: true });
    updateDocumentContent.mockResolvedValue(NOTES);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("notes.txt"));
    await screen.findByText("Original text.");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByLabelText(/edit notes.txt/i);
    await user.clear(textarea);
    await user.type(textarea, "Edited text.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateDocumentContent).toHaveBeenCalledWith("tok", "1", "Edited text."));
  });

  it("renames a document from the detail pane", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([NOTES]);
    getDocumentContent.mockResolvedValue({ content: "text", editable: true });
    renameDocument.mockResolvedValue({ ...NOTES, filename: "renamed.txt" });
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("notes.txt"));

    const nameInput = await screen.findByLabelText("Document name");
    await user.clear(nameInput);
    await user.type(nameInput, "renamed.txt");
    await user.tab();

    await waitFor(() => expect(renameDocument).toHaveBeenCalledWith("tok", "1", "renamed.txt"));
  });

  it("starts a chat about the selected document and closes the panel", async () => {
    const user = userEvent.setup();
    const onChatAboutDocument = vi.fn();
    const onClose = vi.fn();
    listDocuments.mockResolvedValue([NOTES]);
    getDocumentContent.mockResolvedValue({ content: "text", editable: true });
    render(<DocumentsPanel token="tok" onClose={onClose} onChatAboutDocument={onChatAboutDocument} />);
    await user.click(await screen.findByText("notes.txt"));

    await user.click(await screen.findByRole("button", { name: /chat about this document/i }));

    expect(onChatAboutDocument).toHaveBeenCalledWith(NOTES);
    expect(onClose).toHaveBeenCalled();
  });
});
