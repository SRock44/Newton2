import { describe, it, expect } from "vitest";
import { documentTypeLabel, isPreviewableAsPdf } from "../fileType";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("documentTypeLabel", () => {
  it("labels the types that were already supported", () => {
    expect(documentTypeLabel({ filename: "syllabus.pdf", mime_type: "application/pdf" })).toBe("PDF");
    expect(documentTypeLabel({ filename: "notes.md", mime_type: "text/markdown" })).toBe("MD");
    expect(documentTypeLabel({ filename: "notes.txt", mime_type: "text/plain" })).toBe("TXT");
  });

  it("labels lecture slides and Word documents with their own badges", () => {
    expect(documentTypeLabel({ filename: "lecture-4.pptx", mime_type: PPTX_MIME })).toBe("PPTX");
    expect(documentTypeLabel({ filename: "essay.docx", mime_type: DOCX_MIME })).toBe("DOCX");
  });

  it("recognizes them by extension alone when the mime type is generic or missing", () => {
    expect(documentTypeLabel({ filename: "deck.pptx", mime_type: null })).toBe("PPTX");
    expect(documentTypeLabel({ filename: "paper.docx", mime_type: "application/octet-stream" })).toBe("DOCX");
  });

  it("does not let a .docx fall through to the generic DOC fallback", () => {
    expect(documentTypeLabel({ filename: "essay.docx", mime_type: DOCX_MIME })).not.toBe("DOC");
  });

  it("still falls back to DOC for genuinely unrecognized types", () => {
    // A research paper's own LaTeX source is stored as text/plain, so it reads as TXT;
    // something with no recognizable signal at all is what DOC is for.
    expect(documentTypeLabel({ filename: "mystery", mime_type: null })).toBe("DOC");
  });
});

describe("isPreviewableAsPdf", () => {
  it("is true only for real PDFs", () => {
    expect(isPreviewableAsPdf({ filename: "paper.pdf", mime_type: "application/pdf" })).toBe(true);
    expect(isPreviewableAsPdf({ filename: "paper.pdf", mime_type: null })).toBe(true);
  });

  // A .pptx/.docx is non-editable like a PDF, but the webview can't render binary
  // Office XML — sending it to the PDF <iframe> would show an empty frame, so these
  // must take the extracted-text path instead.
  it("is false for the binary Office formats", () => {
    expect(isPreviewableAsPdf({ filename: "deck.pptx", mime_type: PPTX_MIME })).toBe(false);
    expect(isPreviewableAsPdf({ filename: "essay.docx", mime_type: DOCX_MIME })).toBe(false);
  });
});
