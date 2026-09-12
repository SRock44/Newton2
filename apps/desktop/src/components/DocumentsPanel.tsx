import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  deleteDocument,
  generateFlashcards,
  generateStudyPlan,
  listDocuments,
  uploadDocument,
} from "../api";
import type { UploadedDocument } from "../types";

interface DocumentsPanelProps {
  token: string;
  onClose: () => void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/** Upload/list/delete the documents Newton can pull context from during chat (see the
 * backend's RAG pipeline — retrieval happens automatically per chat turn, there's
 * nothing to "activate" here beyond having uploaded something). */
function DocumentsPanel({ token, onClose }: DocumentsPanelProps) {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [planStatusByDoc, setPlanStatusByDoc] = useState<Record<string, string>>({});
  const [cardStatusByDoc, setCardStatusByDoc] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleFileChosen(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const doc = await uploadDocument(token, file);
      setDocuments((prev) => [doc, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't upload ${file.name}.`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDocument(token, id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete this document.");
    }
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Documents</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="modal-subtitle">
          Newton pulls relevant passages from these into chat automatically — no need to
          reference them by name.
        </p>

        {error && <div className="chat-pane-banner chat-pane-banner--error">{error}</div>}

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
          className="new-chat-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload a document"}
        </button>

        {loading ? (
          <p className="session-list-empty">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="session-list-empty">No documents yet.</p>
        ) : (
          <ul className="document-list">
            {documents.map((doc) => (
              <li key={doc.id} className="document-item document-item--stacked">
                <div className="document-item-row">
                  <div>
                    <div className="document-item-name">{doc.filename}</div>
                    <div className="document-item-date">{formatDate(doc.created_at)}</div>
                  </div>
                  <div className="document-item-actions">
                    <button
                      type="button"
                      className="sidebar-signout"
                      onClick={() => handleGeneratePlan(doc)}
                      disabled={planStatusByDoc[doc.id] === "Reading…"}
                    >
                      Study plan
                    </button>
                    <button
                      type="button"
                      className="sidebar-signout"
                      onClick={() => handleGenerateFlashcards(doc)}
                      disabled={cardStatusByDoc[doc.id] === "Reading…"}
                    >
                      Flashcards
                    </button>
                    <button
                      type="button"
                      className="sidebar-signout"
                      onClick={() => handleDelete(doc.id)}
                      aria-label={`Delete ${doc.filename}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {planStatusByDoc[doc.id] && (
                  <div className="document-item-plan-status">{planStatusByDoc[doc.id]}</div>
                )}
                {cardStatusByDoc[doc.id] && (
                  <div className="document-item-plan-status">{cardStatusByDoc[doc.id]}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default DocumentsPanel;
