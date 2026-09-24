import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentViewerPanel from "../DocumentViewerPanel";
import * as api from "../../api";
import * as download from "../../lib/download";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof api>("../../api");
  return {
    ...actual,
    getDocumentContent: vi.fn(),
    annotateDocumentSelection: vi.fn(),
  };
});
vi.mock("../../lib/download", () => ({
  fetchBytes: vi.fn(),
  saveBytesToDisk: vi.fn(async () => ({ path: "/tmp/x" })),
  filtersForFilename: vi.fn(() => []),
}));

// A fake PDF document/page: numPages, a viewport whose width/height the component
// reads, and no-op render/getTextContent — this test is about the panel's own
// behavior (loading state, zoom, the selection toolbar, close/download), not about
// pdf.js's real rendering, which has no meaningful behavior to assert in jsdom anyway
// (no real canvas 2D backend, no real glyph layout).
const fakePage = {
  getViewport: vi.fn(() => ({ width: 600, height: 800 })),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  getTextContent: vi.fn(async () => ({ items: [] })),
};
const fakePdf = { numPages: 1, getPage: vi.fn(async () => fakePage) };

vi.mock("pdfjs-dist", () => {
  class FakeTextLayer {
    render() {
      return Promise.resolve();
    }
  }
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: vi.fn(() => ({ promise: Promise.resolve(fakePdf) })),
    TextLayer: FakeTextLayer,
  };
});

const getDocumentContent = api.getDocumentContent as ReturnType<typeof vi.fn>;
const annotateDocumentSelection = api.annotateDocumentSelection as ReturnType<typeof vi.fn>;
const fetchBytes = download.fetchBytes as ReturnType<typeof vi.fn>;

function selectTextIn(node: Element) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  // jsdom doesn't compute real layout — same helper as DocumentsPanel.test.tsx's own.
  Object.defineProperty(range, "getBoundingClientRect", {
    value: () => ({ top: 100, left: 50, bottom: 120, right: 200, width: 150, height: 20 }),
  });
}

beforeEach(() => {
  getDocumentContent.mockReset();
  annotateDocumentSelection.mockReset();
  fetchBytes.mockReset();
});

describe("DocumentViewerPanel", () => {
  it("shows a text document's extracted content with a real filename in the header", async () => {
    getDocumentContent.mockResolvedValue({ content: "Chapter one begins here.", editable: false });
    render(
      <DocumentViewerPanel
        token="tok"
        documentId="doc-1"
        initialFilename="notes.md"
        onClose={vi.fn()}
        onAskAboutSelection={vi.fn()}
      />,
    );
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    await screen.findByText("Chapter one begins here.");
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it("renders a real PDF's pages via pdf.js instead of the extracted text", async () => {
    getDocumentContent.mockResolvedValue({ content: "extracted text, unused for a pdf", editable: false });
    fetchBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    render(
      <DocumentViewerPanel
        token="tok"
        documentId="doc-2"
        initialFilename="paper.pdf"
        onClose={vi.fn()}
        onAskAboutSelection={vi.fn()}
      />,
    );
    await screen.findByTestId("doc-viewer-pdf");
    expect(screen.queryByText("extracted text, unused for a pdf")).not.toBeInTheDocument();
    // Zoom controls only make sense for a page-rendered PDF.
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("115%")).toBeInTheDocument();
  });

  it("Close calls onClose", async () => {
    getDocumentContent.mockResolvedValue({ content: "text", editable: false });
    const onClose = vi.fn();
    render(
      <DocumentViewerPanel token="tok" documentId="doc-1" initialFilename="a.md" onClose={onClose} onAskAboutSelection={vi.fn()} />,
    );
    await screen.findByText("text");
    await userEvent.click(screen.getByRole("button", { name: "Close document viewer" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Download saves the document's real bytes, not a re-encoded copy of the extracted text", async () => {
    getDocumentContent.mockResolvedValue({ content: "extracted", editable: false });
    fetchBytes.mockResolvedValue(new Uint8Array([9, 9, 9]));
    render(
      <DocumentViewerPanel token="tok" documentId="doc-3" initialFilename="paper.pdf" onClose={vi.fn()} onAskAboutSelection={vi.fn()} />,
    );
    await screen.findByTestId("doc-viewer-pdf");
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(download.saveBytesToDisk).toHaveBeenCalledWith("paper.pdf", new Uint8Array([9, 9, 9]), []));
  });

  it("highlighting text shows Explain/Define/Summarize and a new Ask Newton action", async () => {
    getDocumentContent.mockResolvedValue({ content: "The residual should be under 1e-8.", editable: false });
    render(
      <DocumentViewerPanel token="tok" documentId="doc-1" initialFilename="a.md" onClose={vi.fn()} onAskAboutSelection={vi.fn()} />,
    );
    const body = await screen.findByTestId("doc-viewer-text");
    const node = await within(body).findByText(/residual should be under/);
    selectTextIn(node);
    fireEvent.mouseUp(body);

    expect(screen.getByRole("button", { name: "Explain" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Define" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Summarize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Newton" })).toBeInTheDocument();
  });

  it("Explain calls the real annotate endpoint and shows the answer as a transient popover, never rewriting the document", async () => {
    getDocumentContent.mockResolvedValue({ content: "The residual should be under 1e-8.", editable: false });
    annotateDocumentSelection.mockResolvedValue("It means the error shrank a hundred-millionfold.");
    render(
      <DocumentViewerPanel token="tok" documentId="doc-1" initialFilename="a.md" onClose={vi.fn()} onAskAboutSelection={vi.fn()} />,
    );
    const body = await screen.findByTestId("doc-viewer-text");
    const node = await within(body).findByText(/residual should be under/);
    selectTextIn(node);
    fireEvent.mouseUp(body);
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));

    expect(annotateDocumentSelection).toHaveBeenCalledWith(
      "tok",
      "doc-1",
      "The residual should be under 1e-8.",
      "The residual should be under 1e-8.",
      "explain",
    );
    await screen.findByText("It means the error shrank a hundred-millionfold.");
    expect(screen.getByText("The residual should be under 1e-8.")).toBeInTheDocument();
  });

  it("Ask Newton hands the excerpt up to the parent instead of calling the annotate endpoint", async () => {
    getDocumentContent.mockResolvedValue({ content: "The residual should be under 1e-8.", editable: false });
    const onAsk = vi.fn();
    render(
      <DocumentViewerPanel token="tok" documentId="doc-1" initialFilename="a.md" onClose={vi.fn()} onAskAboutSelection={onAsk} />,
    );
    const body = await screen.findByTestId("doc-viewer-text");
    const node = await within(body).findByText(/residual should be under/);
    selectTextIn(node);
    fireEvent.mouseUp(body);
    await userEvent.click(screen.getByRole("button", { name: "Ask Newton" }));

    expect(onAsk).toHaveBeenCalledWith("The residual should be under 1e-8.");
    expect(annotateDocumentSelection).not.toHaveBeenCalled();
  });
});
