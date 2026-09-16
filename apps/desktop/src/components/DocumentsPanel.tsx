import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  deleteDocument,
  documentRawUrl,
  generateFlashcards,
  generatePracticeExam,
  generateStudyPlan,
  getBillingStatus,
  getDocumentContent,
  listDocuments,
  renameDocument,
  updateDocumentContent,
  uploadDocument,
} from "../api";
import type { BillingStatus, DocumentContent, UploadedDocument } from "../types";
import MessageContent from "./MessageContent";
import RecentItemCard from "./RecentItemCard";
import { documentTypeLabel } from "../lib/fileType";
import { toSnippet } from "../lib/snippet";
import { getDocumentsViewMode, setDocumentsViewMode } from "../lib/preferences";
import type { DocumentsViewMode } from "../lib/preferences";

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
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedDocumentId ?? null);
  const [contentState, setContentState] = useState<ContentState>({ loading: false, error: null, data: null });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [filenameDraft, setFilenameDraft] = useState("");

  // Grid (thumbnail tiles, Google Drive-style) vs. list (compact rows) — both real
  // options rather than picking one for everyone, persisted locally (see
  // lib/preferences.ts, same pattern as the sidebar's collapse toggle).
  const [viewMode, setViewMode] = useState<DocumentsViewMode>(() => getDocumentsViewMode());
  // Content snippets for grid-view thumbnails — fetched lazily only once grid view is
  // actually shown (list view never needs them), same "don't fetch what isn't visible"
  // reasoning as HomeView's own recent-items snippets.
  const [snippetsById, setSnippetsById] = useState<Record<string, string>>({});
  // A Drive-style "⋮" overflow menu per row/card — only one open at a time. Rename is
  // inline-editable directly on the entry itself (like Drive's own rename), not a
  // separate dialog; the other actions reuse the exact same handlers the detail pane's
  // buttons already call, just without requiring the document to be selected/open first.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const selectedDoc = documents.find((d) => d.id === selectedId) ?? null;

  function changeViewMode(mode: DocumentsViewMode) {
    setViewMode(mode);
    setDocumentsViewMode(mode);
  }

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

  useEffect(() => {
    if (viewMode !== "grid") return;
    const missing = documents.filter((d) => !(d.id in snippetsById));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (doc) => {
          try {
            const content = await getDocumentContent(token, doc.id);
            return [doc.id, toSnippet(content.content)] as const;
          } catch {
            return [doc.id, ""] as const; // thumbnail just falls back to skeleton lines
          }
        }),
      );
      if (!cancelled) setSnippetsById((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, documents, token]);

  // Closes the open "⋮" menu on any click outside it — checked via the entry's own
  // data-doc-menu-root marker rather than a ref, since which entry that is changes as
  // the open menu changes.
  useEffect(() => {
    if (!openMenuId) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-doc-menu-root="${openMenuId}"]`)) {
        setOpenMenuId(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenuId(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuId]);

  // Drives the free-plan generation-count note next to the Flashcards/Practice
  // exam/Study plan buttons below — see handleGenerate*'s honest-expectations note
  // beside those buttons. Non-fatal if this fails: the note just doesn't render,
  // same "don't block the rest of the panel" pattern as SettingsPanel's billing fetch.
  useEffect(() => {
    let cancelled = false;
    getBillingStatus(token)
      .then((status) => {
        if (!cancelled) setBilling(status);
      })
      .catch(() => {
        // Non-fatal — see comment above.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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

  // A confirmation prompt before deleting — the "⋮" menu makes delete reachable in one
  // click straight from the grid/list, without opening the document first, so it's
  // worth the one extra step it didn't have when it was only a button inside the
  // already-open detail pane.
  function handleDeleteWithConfirm(doc: UploadedDocument) {
    setOpenMenuId(null);
    if (window.confirm(`Delete "${doc.filename}"? This can't be undone.`)) {
      handleDelete(doc);
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

  function startRename(doc: UploadedDocument) {
    setOpenMenuId(null);
    setRenamingId(doc.id);
    setRenameDraft(doc.filename);
  }

  async function commitInlineRename(doc: UploadedDocument) {
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === doc.filename) return;
    try {
      const updated = await renameDocument(token, doc.id, trimmed);
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't rename this document.");
    }
  }

  // The rest of the "⋮" menu's actions reuse the exact same handlers the detail pane's
  // own buttons call — they already take the target doc directly rather than relying on
  // `selectedDoc`. Selecting the document too (rather than leaving selection alone)
  // means its status line ("Added 6 items — see Flashcards", etc.) has somewhere to
  // actually show up, since that status only ever renders in the now-open detail pane.
  function handleMenuChat(doc: UploadedDocument) {
    setOpenMenuId(null);
    handleChatAboutDocument(doc);
  }

  function handleMenuGenerate(doc: UploadedDocument, action: (doc: UploadedDocument) => void) {
    setOpenMenuId(null);
    setSelectedId(doc.id);
    action(doc);
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

  // Shared by both the grid and the list — the entry itself is the read-only
  // RecentItemCard (or, mid-rename, a plain input standing in for its title), with the
  // "⋮" trigger positioned as an absolutely-placed SIBLING rather than nested inside
  // it: RecentItemCard's root is itself a <button>, and a <button> inside a <button> is
  // invalid HTML with unpredictable click-bubbling, not just a style nitpick.
  function renderEntry(doc: UploadedDocument, variant: "row" | "card") {
    const typeLabel = documentTypeLabel(doc);
    const menuOpen = openMenuId === doc.id;
    const renaming = renamingId === doc.id;

    return (
      <div className={`doc-entry doc-entry--${variant}`} key={doc.id} data-doc-menu-root={doc.id}>
        {renaming ? (
          <div className={`recent-item-card recent-item-card--${variant} doc-entry-renaming`}>
            {variant === "card" ? (
              <span className="recent-item-thumb">
                <span className="recent-item-thumb-badge">{typeLabel}</span>
                {snippetsById[doc.id] ? (
                  <span className="recent-item-thumb-text">{snippetsById[doc.id]}</span>
                ) : (
                  <span className="recent-item-thumb-lines" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                )}
              </span>
            ) : (
              <span className="recent-item-card-icon" aria-hidden="true">
                {typeLabel}
              </span>
            )}
            <span className="recent-item-card-body">
              <input
                className="doc-rename-input"
                autoFocus
                value={renameDraft}
                aria-label={`Rename ${doc.filename}`}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => commitInlineRename(doc)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  else if (e.key === "Escape") setRenamingId(null);
                }}
              />
            </span>
          </div>
        ) : (
          <RecentItemCard
            variant={variant}
            typeLabel={typeLabel}
            title={doc.filename}
            timestamp={doc.created_at}
            snippet={variant === "card" ? snippetsById[doc.id] : undefined}
            active={doc.id === selectedId}
            onClick={() => setSelectedId(doc.id)}
          />
        )}

        <div className="doc-menu-wrap">
          <button
            type="button"
            className="doc-menu-trigger"
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenuId(menuOpen ? null : doc.id);
            }}
            aria-label={`More actions for ${doc.filename}`}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="doc-menu-popover" role="menu">
              <button type="button" role="menuitem" onClick={() => handleMenuChat(doc)}>
                Chat about this
              </button>
              <button type="button" role="menuitem" onClick={() => startRename(doc)}>
                Rename
              </button>
              <button type="button" role="menuitem" onClick={() => handleMenuGenerate(doc, handleGeneratePlan)}>
                Study plan
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleMenuGenerate(doc, handleGenerateFlashcards)}
              >
                Flashcards
              </button>
              <button type="button" role="menuitem" onClick={() => handleMenuGenerate(doc, handleGenerateExam)}>
                Practice exam
              </button>
              <button
                type="button"
                role="menuitem"
                className="doc-menu-item--danger"
                onClick={() => handleDeleteWithConfirm(doc)}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="documents-page">
      <div className="documents-page-toolbar">
        <p className="modal-subtitle">
          Newton pulls relevant passages from these into chat automatically — no need to
          reference them by name. Select a document to view, edit, or chat about it.
        </p>

        <div className="documents-page-toolbar-actions">
          <div className="view-toggle" role="group" aria-label="Document view">
            <button
              type="button"
              className={`view-toggle-btn${viewMode === "grid" ? " view-toggle-btn--active" : ""}`}
              onClick={() => changeViewMode("grid")}
              aria-pressed={viewMode === "grid"}
              aria-label="Grid view"
              title="Grid view"
            >
              ▦
            </button>
            <button
              type="button"
              className={`view-toggle-btn${viewMode === "list" ? " view-toggle-btn--active" : ""}`}
              onClick={() => changeViewMode("list")}
              aria-pressed={viewMode === "list"}
              aria-label="List view"
              title="List view"
            >
              ☰
            </button>
          </div>

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
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <div className="documents-drive">
          <div className={`documents-list-pane documents-list-pane--${viewMode}`}>
            {loading ? (
              <p className="empty-state-text">Loading…</p>
            ) : documents.length === 0 ? (
              <p className="empty-state-text">No documents yet — upload one to get started.</p>
            ) : viewMode === "grid" ? (
              <div className="documents-grid">{documents.map((doc) => renderEntry(doc, "card"))}</div>
            ) : (
              <div className="documents-rows">{documents.map((doc) => renderEntry(doc, "row"))}</div>
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
                      onClick={() => handleDeleteWithConfirm(selectedDoc)}
                      aria-label={`Delete ${selectedDoc.filename}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Honest, non-punitive heads-up before generating — free accounts get a
                    smaller item count per request, never a time-based limit (no
                    daily/weekly cap exists anywhere in this app). Shown next to the
                    generation buttons rather than only after the fact, so a student
                    knows what to expect going in. Pro users already get the larger
                    count, so nothing to show them here. */}
                {billing && billing.plan !== "pro" && (
                  <p className="doc-generation-note">
                    Free plan generates up to {billing.free_generation_target} items per request — Pro generates
                    up to {billing.pro_generation_target}.
                  </p>
                )}

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
