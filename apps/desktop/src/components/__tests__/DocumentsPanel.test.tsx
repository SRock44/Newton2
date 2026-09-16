import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    getBillingStatus: vi.fn(),
    getDocumentContent: vi.fn(),
    updateDocumentContent: vi.fn(),
    renameDocument: vi.fn(),
  };
});

const listDocuments = api.listDocuments as ReturnType<typeof vi.fn>;
const uploadDocument = api.uploadDocument as ReturnType<typeof vi.fn>;
const deleteDocument = api.deleteDocument as ReturnType<typeof vi.fn>;
const generateStudyPlan = api.generateStudyPlan as ReturnType<typeof vi.fn>;
const getBillingStatus = api.getBillingStatus as ReturnType<typeof vi.fn>;
const getDocumentContent = api.getDocumentContent as ReturnType<typeof vi.fn>;
const updateDocumentContent = api.updateDocumentContent as ReturnType<typeof vi.fn>;
const renameDocument = api.renameDocument as ReturnType<typeof vi.fn>;

const SYLLABUS = { id: "1", filename: "syllabus.pdf", mime_type: "application/pdf", created_at: "2026-01-01T00:00:00Z" };
const NOTES = { id: "1", filename: "notes.txt", mime_type: "text/plain", created_at: "2026-01-01T00:00:00Z" };

const FREE_BILLING_STATUS = {
  plan: "free" as const,
  subscription_status: null,
  current_period_end: null,
  credits_used_cents: 0,
  credits_limit_cents: 0,
  credits_reset_at: null,
  preferred_pro_model: "deepseek/deepseek-v4-flash-0731",
  free_generation_target: 5,
  pro_generation_target: 15,
};

const PRO_BILLING_STATUS = {
  ...FREE_BILLING_STATUS,
  plan: "pro" as const,
};

describe("DocumentsPanel", () => {
  beforeEach(() => {
    listDocuments.mockReset();
    uploadDocument.mockReset();
    deleteDocument.mockReset();
    generateStudyPlan.mockReset();
    getBillingStatus.mockReset();
    getDocumentContent.mockReset();
    updateDocumentContent.mockReset();
    renameDocument.mockReset();
    getDocumentContent.mockResolvedValue({ content: "", editable: true });
    getBillingStatus.mockResolvedValue(FREE_BILLING_STATUS);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["pdf bytes"])));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    window.localStorage.clear();
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
    const { container } = render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("notes.txt"));

    // Scoped to the detail pane — grid view's own thumbnail also shows a snippet of the
    // same short mock content, so the plain text is ambiguous unscoped.
    const detailPane = container.querySelector(".documents-detail-pane") as HTMLElement;
    expect(await within(detailPane).findByText("Hello from the document.")).toBeInTheDocument();
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

  // Documents is a real page mounted in place of chat (see App.tsx's mainView), not a
  // floating modal — no backdrop/overlay, no dialog box, no "×" close button pretending
  // to be one. onClose is still a prop (App.tsx wires it to switching back to the chat
  // view once "Chat about this document" hands off — see the test below), just never
  // rendered as a close affordance here.
  it("renders as a plain page — no modal overlay, dialog panel, or close button", async () => {
    listDocuments.mockResolvedValue([]);
    const { container } = render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await screen.findByText(/no documents yet/i);

    expect(container.querySelector(".modal-overlay")).not.toBeInTheDocument();
    expect(container.querySelector(".modal-panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^close$/i })).not.toBeInTheDocument();
    expect(container.querySelector(".documents-page")).toBeInTheDocument();
  });

  it("selects the given document up front when initialSelectedDocumentId is set (an attached-document chip's navigation)", async () => {
    listDocuments.mockResolvedValue([NOTES]);
    getDocumentContent.mockResolvedValue({ content: "Hello from the document.", editable: true });
    render(
      <DocumentsPanel
        token="tok"
        onClose={() => {}}
        onChatAboutDocument={() => {}}
        initialSelectedDocumentId="1"
      />,
    );

    await waitFor(() => expect(getDocumentContent).toHaveBeenCalledWith("tok", "1"));
    expect(await screen.findByText("Hello from the document.")).toBeInTheDocument();
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
    const { container } = render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("notes.txt"));
    // Scoped to the detail pane — grid view's own thumbnail also shows a snippet of the
    // same short mock content, so the plain text is ambiguous unscoped.
    const detailPane = container.querySelector(".documents-detail-pane") as HTMLElement;
    await within(detailPane).findByText("Original text.");

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

  // Free-tier usage-ceiling visibility (ROADMAP.md) — the real limit is the number of
  // items one generation call produces, not any kind of time-based rate limit (no
  // daily/weekly cap exists anywhere in this app). The note must appear next to the
  // generation buttons for a free-plan student, be absent for Pro, and never use
  // wording that could be misread as a time-based limit.
  it("shows a free-plan student an honest generation-count note next to the generation buttons", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    getBillingStatus.mockResolvedValue(FREE_BILLING_STATUS);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("syllabus.pdf"));

    const note = await screen.findByText(/free plan generates up to 5 items per request/i);
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/pro generates up to 15/i);
  });

  it("does not show the generation-count note to a Pro-plan student", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    getBillingStatus.mockResolvedValue(PRO_BILLING_STATUS);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("syllabus.pdf"));

    // Give the billing fetch a chance to resolve before asserting absence.
    await waitFor(() => expect(getBillingStatus).toHaveBeenCalled());
    expect(screen.queryByText(/generates up to/i)).not.toBeInTheDocument();
  });

  it("never implies a time-based limit in the generation-count note", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    getBillingStatus.mockResolvedValue(FREE_BILLING_STATUS);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await user.click(await screen.findByText("syllabus.pdf"));

    const note = await screen.findByText(/free plan generates up to 5 items per request/i);
    const lowered = note.textContent?.toLowerCase() ?? "";
    for (const phrase of ["per day", "daily", "per week", "weekly", "per hour", "hourly", "per month", "monthly", "24 hours"]) {
      expect(lowered).not.toContain(phrase);
    }
  });

  it("does not block the panel from rendering when the billing-status fetch fails", async () => {
    listDocuments.mockResolvedValue([SYLLABUS]);
    getBillingStatus.mockRejectedValue(new api.ApiError("Couldn't load your plan."));
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);

    expect(await screen.findByText("syllabus.pdf")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Grid/list view toggle and the per-entry "⋮" overflow menu.
  // ---------------------------------------------------------------------------

  it("defaults to grid view, showing a thumbnail with real content, and can switch to list view", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "Course policies and grading breakdown.", editable: false });
    const { container } = render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);

    await screen.findByText("syllabus.pdf");
    expect(container.querySelector(".documents-grid")).toBeInTheDocument();
    expect(await screen.findByText("Course policies and grading breakdown.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "List view" }));
    expect(container.querySelector(".documents-rows")).toBeInTheDocument();
    expect(container.querySelector(".documents-grid")).not.toBeInTheDocument();
  });

  it("remembers the chosen view mode across remounts", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    const { container, unmount } = render(
      <DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />,
    );
    await screen.findByText("syllabus.pdf");
    await user.click(screen.getByRole("button", { name: "List view" }));
    unmount();

    const second = render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await second.findByText("syllabus.pdf");
    expect(second.container.querySelector(".documents-rows")).toBeInTheDocument();
    expect(container).not.toBe(second.container); // sanity: genuinely a fresh mount
  });

  it("the '⋮' menu's Study plan action selects the document and generates without opening it first", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    generateStudyPlan.mockResolvedValue([{ id: "a" }]);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await screen.findByText("syllabus.pdf");

    await user.click(await screen.findByRole("button", { name: /more actions for syllabus.pdf/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Study plan" }));

    expect(generateStudyPlan).toHaveBeenCalledWith("tok", "1");
    expect(await screen.findByText(/added 1 item/i)).toBeInTheDocument();
  });

  it("the '⋮' menu's Delete action asks for confirmation and does nothing if declined", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await screen.findByText("syllabus.pdf");

    await user.click(await screen.findByRole("button", { name: /more actions for syllabus.pdf/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(screen.getByText("syllabus.pdf")).toBeInTheDocument();
  });

  it("renames a document inline from the '⋮' menu, without opening the detail pane", async () => {
    const user = userEvent.setup();
    listDocuments.mockResolvedValue([SYLLABUS]);
    getDocumentContent.mockResolvedValue({ content: "", editable: false });
    renameDocument.mockResolvedValue({ ...SYLLABUS, filename: "renamed.pdf" });
    render(<DocumentsPanel token="tok" onClose={() => {}} onChatAboutDocument={() => {}} />);
    await screen.findByText("syllabus.pdf");

    await user.click(await screen.findByRole("button", { name: /more actions for syllabus.pdf/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByLabelText("Rename syllabus.pdf");
    await user.clear(input);
    await user.type(input, "renamed.pdf");
    await user.tab();

    await waitFor(() => expect(renameDocument).toHaveBeenCalledWith("tok", "1", "renamed.pdf"));
    expect(await screen.findByText("renamed.pdf")).toBeInTheDocument();
  });
});
