import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  deleteDocument,
  documentRawUrl,
  generateFlashcards,
  generatePracticeExam,
  generateStudyPlan,
  getDocumentContent,
  listDocuments,
  renameDocument,
  updateDocumentContent,
  uploadDocument,
} from "../api";
import type { DocumentContent, UploadedDocument } from "../types";
import MessageContent from "./MessageContent";

interface DocumentsPanelProps {
  token: string;
  /** Called after "Chat about this document" hands off to a new chat — App.tsx wires
   * this to switching mainView back to "chat", the page-level equivalent of the old
   * modal's onClose. Not rendered as a close button here (this is a real page, not a
   * modal) — see App.tsx's mainView. */
  onClose: () => void;
  /** Starts a new chat scoped toward this document (see App.tsx) — the panel closes
   * itself right after so the student lands directly in the new conversation. */
  onChatAboutDocument: (doc: UploadedDocument) => void;
  /** Set when a message's attached-document chip sends the student here for a specific
   * document (see MessageBubble/AttachedDocumentChip and App.tsx's handleOpenDocument)
   * — selects it as soon as the drive mounts. Undefined/null just lands on the drive
   * with nothing selected, same as opening it any other way. */
  initialSelectedDocumentId?: string | null;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/** Short type badge for the file-list row — PDF is view-only everywhere else in this
 * panel, so it's worth surfacing at a glance before the student even opens it. */
function docTypeLabel(doc: UploadedDocument): string {
  const name = doc.filename.toLowerCase();
  if (name.endsWith(".pdf") || doc.mime_type === "application/pdf") return "PDF";
  if (name.endsWith(".md") || name.endsWith(".markdown") || doc.mime_type === "text/markdown") return "MD";
  if (name.endsWith(".txt") || doc.mime_type === "text/plain") return "TXT";
  return "DOC";
}

interface ContentState {
  loading: boolean;
  error: string | null;
  data: DocumentContent | null;
}

/** A real document drive: a file list on the left, and a preview/edit/chat pane on
 * the right for whichever document is selected. Newton's RAG retrieval already
 * searches across every uploaded document on every chat turn (see app/memory/rag.py)
 * — this panel is about actually seeing and touching what was uploaded, not about
 * making retrieval work. */
function DocumentsPanel({ token, onClose, onChatAboutDocument, initialSelectedDocumentId }: DocumentsPanelProps) {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [planStatusByDoc, setPlanStatusByDoc] = useState<Record<string, string>>({});
  const [cardStatusByDoc, setCardStatusByDoc] = useState<Record<string, string>>({});
  const [examStatusByDoc, setExamStatusByDoc] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedDocumentId ?? null);
  const [contentState, setContentState] = useState<ContentState>({ loading: false, error: null, data: null });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [filenameDraft, setFilenameDraft] = useState("");

  const selectedDoc = documents.find((d) => d.id === selectedId) ?? null;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setDocuments(await listDocuments(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset per-document UI state whenever the selection changes, and load that
  // document's content (and, for a view-only PDF, its raw bytes for the embedded
  // viewer — same auth'd-blob pattern as AttachedImage.tsx).
  useEffect(() => {
    setEditing(false);
    setDetailError(null);
    setFilenameDraft(selectedDoc?.filename ?? "");
    setPdfUrl(null);
    if (!selectedId) {
      setContentState({ loading: false, error: null, data: null });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setContentState({ loading: true, error: null, data: null });

    (async () => {
      try {
        const data = await getDocumentContent(token, selectedId);
        if (cancelled) return;
        setContentState({ loading: false, error: null, data });

        if (!data.editable) {
          const res = await fetch(documentRawUrl(selectedId), {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error("raw fetch failed");
          const blob = await res.blob();
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setPdfUrl(objectUrl);
        }
      } catch (err) {
        if (!cancelled) {
          setContentState({
            loading: false,
            error: err instanceof ApiError ? err.message : "Couldn't load this document.",
            data: null,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedId]);

  async function handleFileChosen(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const doc = await uploadDocument(token, file);
      setDocuments((prev) => [doc, ...prev]);
      setSelectedId(doc.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't upload ${file.name}.`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(doc: UploadedDocument) {
    try {
      await deleteDocument(token, doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      if (selectedId === doc.id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete this document.");
    }
  }

  async function commitFilename() {
    if (!selectedDoc) return;
    const trimmed = filenameDraft.trim();
    if (!trimmed || trimmed === selectedDoc.filename) {
      setFilenameDraft(selectedDoc.filename);
      return;
    }
    try {
      const updated = await renameDocument(token, selectedDoc.id, trimmed);
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Couldn't rename this document.");
      setFilenameDraft(selectedDoc.filename);
    }
  }

  function startEdit() {
    if (!contentState.data) return;
    setDraftText(contentState.data.content);
    setDetailError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function saveEdit() {
    if (!selectedDoc) return;
    setSaving(true);
    setDetailError(null);
    try {
      await updateDocumentContent(token, selectedDoc.id, draftText);
      setContentState((prev) => (prev.data ? { ...prev, data: { ...prev.data, content: draftText } } : prev));
      setEditing(false);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Couldn't save this document.");
    } finally {
      setSaving(false);
    }
  }

  function handleChatAboutDocument(doc: UploadedDocument) {
    onChatAboutDocument(doc);
    onClose();
  }

  async function handleGeneratePlan(doc: UploadedDocument) {
    setPlanStatusByDoc((prev) => ({ ...prev, [doc.id]: "Reading…" }));
    try {
      const items = await generateStudyPlan(token, doc.id);
      setPlanStatusByDoc((prev) => ({
        ...prev,
        [doc.id]:
          items.length > 0
            ? `Added ${items.length} item${items.length === 1 ? "" : "s"} — see Study Plan`
            : "No gradable items found in this document",
      }));
    } catch (err) {
      setPlanStatusByDoc((prev) => ({
        ...prev,
        [doc.id]: err instanceof ApiError ? err.message : "Couldn't generate a study plan.",
      }));
    }
  }

  async function handleGenerateFlashcards(doc: UploadedDocument) {
    setCardStatusByDoc((prev) => ({ ...prev, [doc.id]: "Reading…" }));
    try {
      const cards = await generateFlashcards(token, doc.id);
      setCardStatusByDoc((prev) => ({
        ...prev,
        [doc.id]:
          cards.length > 0
            ? `Added ${cards.length} card${cards.length === 1 ? "" : "s"} — see Flashcards`
            : "Nothing flashcard-worthy found in this document",
      }));
    } catch (err) {
      setCardStatusByDoc((prev) => ({
        ...prev,
        [doc.id]: err instanceof ApiError ? err.message : "Couldn't generate flashcards.",
      }));
    }
  }

  async function handleGenerateExam(doc: UploadedDocument) {
    setExamStatusByDoc((prev) => ({ ...prev, [doc.id]: "Writing…" }));
    try {
      const exam = await generatePracticeExam(token, doc.id);
      setExamStatusByDoc((prev) => ({
        ...prev,
        [doc.id]:
          exam.questions.length > 0
            ? `Added a ${exam.questions.length}-question exam — see Practice Exams`
            : "Couldn't write questions from this document",
      }));
    } catch (err) {
      setExamStatusByDoc((prev) => ({
        ...prev,
        [doc.id]: err instanceof ApiError ? err.message : "Couldn't generate a practice exam.",
      }));
    }
  }

  return (
    <div className="documents-page">
      <div className="documents-page-toolbar">
        <p className="modal-subtitle">
          Newton pulls relevant passages from these into chat automatically — no need to
          reference them by name. Select a document to view, edit, or chat about it.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
          onChange={(e) => handleFileChosen(e.target.files?.[0])}
          disabled={uploading}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload a document"}
        </button>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <div className="documents-drive">
          <div className="documents-list-pane">
            {loading ? (
              <p className="empty-state-text">Loading…</p>
            ) : documents.length === 0 ? (
              <p className="empty-state-text">No documents yet — upload one to get started.</p>
            ) : (
              <ul className="item-list">
                {documents.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className={`doc-row${doc.id === selectedId ? " doc-row--active" : ""}`}
                      onClick={() => setSelectedId(doc.id)}
                    >
                      <span className="doc-row-icon" aria-hidden="true">
                        {docTypeLabel(doc)}
                      </span>
                      <span className="doc-row-main">
                        <div className="doc-row-title">{doc.filename}</div>
                        <div className="doc-row-meta">{formatDate(doc.created_at)}</div>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="documents-detail-pane">
            {!selectedDoc ? (
              <p className="empty-state-text">Select a document to preview it.</p>
            ) : (
              <>
                <div className="doc-detail-header">
                  <input
                    className="doc-detail-title-input"
                    value={filenameDraft}
                    aria-label="Document name"
                    onChange={(e) => setFilenameDraft(e.target.value)}
                    onBlur={commitFilename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        setFilenameDraft(selectedDoc.filename);
                        e.currentTarget.blur();
                      }
                    }}
                  />
                  <div className="doc-detail-actions">
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      onClick={() => handleChatAboutDocument(selectedDoc)}
                    >
                      Chat about this document
                    </button>
                    {contentState.data?.editable && !editing && (
                      <button type="button" className="btn-secondary-sm" onClick={startEdit}>
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      onClick={() => handleGeneratePlan(selectedDoc)}
                      disabled={planStatusByDoc[selectedDoc.id] === "Reading…"}
                    >
                      Study plan
                    </button>
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      onClick={() => handleGenerateFlashcards(selectedDoc)}
                      disabled={cardStatusByDoc[selectedDoc.id] === "Reading…"}
                    >
                      Flashcards
                    </button>
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      onClick={() => handleGenerateExam(selectedDoc)}
                      disabled={examStatusByDoc[selectedDoc.id] === "Writing…"}
                    >
                      Practice exam
                    </button>
                    <button
                      type="button"
                      className="btn-secondary-sm btn-secondary-sm--danger"
                      onClick={() => handleDelete(selectedDoc)}
                      aria-label={`Delete ${selectedDoc.filename}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {detailError && <div className="banner banner--error">{detailError}</div>}
                {planStatusByDoc[selectedDoc.id] && (
                  <div className="item-status">{planStatusByDoc[selectedDoc.id]}</div>
                )}
                {cardStatusByDoc[selectedDoc.id] && (
                  <div className="item-status">{cardStatusByDoc[selectedDoc.id]}</div>
                )}
                {examStatusByDoc[selectedDoc.id] && (
                  <div className="item-status">{examStatusByDoc[selectedDoc.id]}</div>
                )}

                {contentState.loading ? (
                  <p className="empty-state-text">Loading…</p>
                ) : contentState.error ? (
                  <div className="banner banner--error">{contentState.error}</div>
                ) : editing ? (
                  <>
                    <div className="doc-detail-body">
                      <textarea
                        className="doc-detail-editor"
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        aria-label={`Edit ${selectedDoc.filename}`}
                      />
                    </div>
                    <div className="doc-detail-editor-actions">
                      <button type="button" className="btn-secondary-sm" onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </button>
                      <button type="button" className="btn-primary" onClick={saveEdit} disabled={saving}>
                        {saving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </>
                ) : pdfUrl ? (
                  <div className="doc-detail-body doc-detail-body--pdf">
                    <iframe className="doc-detail-pdf-frame" src={pdfUrl} title={selectedDoc.filename} />
                  </div>
                ) : (
                  <div className="doc-detail-body">
                    <MessageContent content={contentState.data?.content ?? ""} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
  );
}


export default DocumentsPanel;
