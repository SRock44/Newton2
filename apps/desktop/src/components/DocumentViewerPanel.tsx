import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ApiError, annotateDocumentSelection, documentRawUrl, getDocumentContent } from "../api";
import { fetchBytes, filtersForFilename, saveBytesToDisk } from "../lib/download";
import { isPreviewableAsPdf } from "../lib/fileType";
import {
  DOC_PANEL_DEFAULT_WIDTH,
  DOC_PANEL_MAX_WIDTH,
  DOC_PANEL_MIN_WIDTH,
  getDocPanelWidth,
  setDocPanelWidth,
} from "../lib/preferences";
import { usePanelResize } from "../lib/usePanelResize";
import type { NoteAnnotateAction } from "../types";
import MessageContent from "./MessageContent";
import PanelResizeHandle from "./PanelResizeHandle";

// pdf.js needs its worker's real URL, not a bundled string — this is the standard
// Vite pattern (see https://github.com/mozilla/pdf.js/wiki, "Bundling with Vite"), and
// it only needs to run once for the life of the app.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const ANNOTATE_CONTEXT_CHARS = 4000;
const ANNOTATE_ACTION_LABELS: Record<NoteAnnotateAction, string> = {
  explain: "Newton explained",
  define: "Newton defined",
  summarize: "Newton summarized",
};
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.2;
const ZOOM_STEP = 0.15;
// The backing canvas renders at a higher pixel density than its CSS size (crisp on a
// HiDPI display), independent of the zoom level itself — the same split any real PDF
// viewer makes between "how big" (the viewport passed to the text layer, which the
// canvas's CSS width/height match) and "how sharp" (the canvas's actual pixel buffer).
const OUTPUT_SCALE = 1.5;

interface SelectionToolbarState {
  text: string;
  top: number;
  left: number;
}
interface AnnotationResultState {
  action: NoteAnnotateAction;
  text: string;
  top: number;
  left: number;
}

interface DocumentViewerPanelProps {
  token: string;
  documentId: string;
  /** Known immediately from the chat message's own attachment marker, so the header
   * shows a real name before the content fetch below has even started. */
  initialFilename: string;
  onClose: () => void;
  /** "Ask Newton" on a selection doesn't call the annotate endpoint (that's read-only,
   * see handleAnnotate below) — it hands the quoted excerpt back up to App.tsx, which
   * quotes it into the composer next to this panel and focuses it. Same "never send
   * anything on the student's behalf" rule as every other attach flow in this app: the
   * student still writes and sends their own instruction. */
  onAskAboutSelection: (excerpt: string) => void;
}

/** Opens a document ALONGSIDE the active chat (split, like the chat's own composer
 * attach flow, not a navigation away from it) — for reading and reacting to something
 * Newton just produced (a written paper, an uploaded reading) without losing the
 * conversation that's about it. A real PDF renders with pdf.js (canvas pages plus a
 * true, positioned text layer — the app's other PDF preview, DocumentsPanel's, is an
 * OS-native <iframe> that can't be selected from JS at all, which is exactly why
 * highlighting a PDF needs a real renderer here); anything else reuses the same
 * extracted-text preview DocumentsPanel shows. Highlighting text offers the same
 * Explain/Define/Summarize this app already gives a note or a document (see
 * DocumentsPanel.tsx's own selection toolbar, same backend call), plus "Ask Newton" —
 * see onAskAboutSelection above. */
function DocumentViewerPanel({ token, documentId, initialFilename, onClose, onAskAboutSelection }: DocumentViewerPanelProps) {
  const resize = usePanelResize({
    initial: getDocPanelWidth(),
    defaultWidth: DOC_PANEL_DEFAULT_WIDTH,
    min: DOC_PANEL_MIN_WIDTH,
    max: DOC_PANEL_MAX_WIDTH,
    direction: -1,
    persist: setDocPanelWidth,
  });

  const [filename, setFilename] = useState(initialFilename);
  const [text, setText] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Fit the page to the panel's width the first time it's known, rather than always
  // opening at a literal 100% that may run wider than the panel and get clipped —
  // never re-applied after that first time, so it doesn't fight a zoom the student set.
  const fitAppliedRef = useRef(false);
  const handleFirstPageWidth = useCallback((naturalWidth: number) => {
    if (fitAppliedRef.current) return;
    // No real layout yet (or a test environment with no layout engine at all) — leave
    // the default 100% rather than fitting against a meaningless zero width.
    const available = (bodyRef.current?.clientWidth ?? 0) - 32;
    if (available <= 0) return;
    fitAppliedRef.current = true;
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, available / naturalWidth)));
  }, []);

  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);
  const [annotationResult, setAnnotationResult] = useState<AnnotationResultState | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [annotateError, setAnnotateError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const isPdf = isPreviewableAsPdf({ filename, mime_type: null });

  // Reload whenever a different document is opened into this same panel (clicking a
  // second attachment chip while it's already open reuses the mounted panel).
  useEffect(() => {
    setFilename(initialFilename);
    setText(null);
    setPdfBytes(null);
    setError(null);
    setSelectionToolbar(null);
    setAnnotationResult(null);
    setZoom(1);
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const data = await getDocumentContent(token, documentId);
        if (cancelled) return;
        if (!data.editable && isPreviewableAsPdf({ filename: initialFilename, mime_type: null })) {
          setPdfBytes(await fetchBytes(documentRawUrl(documentId), token));
        } else {
          setText(data.content);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load this document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, token]);

  function handleSelectionMouseUp(_event: ReactMouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionToolbar(null);
      return;
    }
    const selected = selection.toString().trim();
    if (!selected || !previewRef.current?.contains(selection.anchorNode)) {
      setSelectionToolbar(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setSelectionToolbar({ text: selected, top: rect.top, left: rect.left });
    setAnnotationResult(null);
  }

  async function handleAnnotate(action: NoteAnnotateAction) {
    if (!selectionToolbar) return;
    const { text: selected, top, left } = selectionToolbar;
    setAnnotating(true);
    setAnnotateError(null);
    setSelectionToolbar(null);
    try {
      const context = (text ?? "").slice(0, ANNOTATE_CONTEXT_CHARS);
      const generated = await annotateDocumentSelection(token, documentId, selected, context, action);
      setAnnotationResult({ action, text: generated, top, left });
    } catch (err) {
      setAnnotateError(err instanceof ApiError ? err.message : "Couldn't get a response for that selection.");
    } finally {
      setAnnotating(false);
    }
  }

  function handleAsk() {
    if (!selectionToolbar) return;
    onAskAboutSelection(selectionToolbar.text);
    setSelectionToolbar(null);
  }

  async function handleDownload() {
    setDownloadStatus(null);
    try {
      const bytes = isPdf ? await fetchBytes(documentRawUrl(documentId), token) : (pdfBytes ?? new TextEncoder().encode(text ?? ""));
      const result = await saveBytesToDisk(filename, bytes, filtersForFilename(filename));
      if (result.path) setDownloadStatus(`Saved to ${result.path}`);
    } catch {
      setDownloadStatus("Couldn't download this document.");
    }
  }

  return (
    <>
      {/* Handle first in DOM, on this panel's left edge — same convention as
          ContextPanel.tsx's mirror-image handle on the opposite side of the window. */}
      <PanelResizeHandle label="Resize document viewer" min={DOC_PANEL_MIN_WIDTH} max={DOC_PANEL_MAX_WIDTH} {...resize} />
      <section
        className="doc-viewer-panel"
        aria-label={`${filename}, document viewer`}
        style={{ ["--doc-panel-width" as string]: `${resize.width}px` }}
      >
        <header className="doc-viewer-panel__header">
          <span className="doc-viewer-panel__filename" title={filename}>
            {filename}
          </span>
          <div className="doc-viewer-panel__toolbar">
            {isPdf && pdfBytes && (
              <>
                <button
                  type="button"
                  className="doc-viewer-panel__icon-btn"
                  onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                  aria-label="Zoom out"
                  disabled={zoom <= ZOOM_MIN}
                >
                  −
                </button>
                <span className="doc-viewer-panel__zoom-level">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  className="doc-viewer-panel__icon-btn"
                  onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
                  aria-label="Zoom in"
                  disabled={zoom >= ZOOM_MAX}
                >
                  +
                </button>
              </>
            )}
            <button type="button" className="btn-secondary-sm" onClick={handleDownload}>
              Download
            </button>
            <button type="button" className="doc-viewer-panel__icon-btn" onClick={onClose} aria-label="Close document viewer">
              ×
            </button>
          </div>
        </header>

        {downloadStatus && <div className="item-status doc-viewer-panel__status">{downloadStatus}</div>}

        <div className="doc-viewer-panel__body" ref={bodyRef}>
          {loading ? (
            <p className="empty-state-text">Loading…</p>
          ) : error ? (
            <div className="banner banner--error">{error}</div>
          ) : pdfBytes ? (
            <PdfPages
              bytes={pdfBytes}
              zoom={zoom}
              previewRef={previewRef}
              onMouseUp={handleSelectionMouseUp}
              onFirstPageWidth={handleFirstPageWidth}
            />
          ) : (
            <div
              className="doc-detail-body doc-viewer-panel__text"
              ref={previewRef}
              onMouseUp={handleSelectionMouseUp}
              data-testid="doc-viewer-text"
            >
              <MessageContent content={text ?? ""} />
            </div>
          )}

          {annotateError && <div className="banner banner--error">{annotateError}</div>}

          {selectionToolbar && (
            <div
              className="notepad-window__selection-toolbar doc-annotate-toolbar"
              style={{ top: Math.max(selectionToolbar.top - 44, 4), left: Math.max(selectionToolbar.left, 4) }}
            >
              <button type="button" disabled={annotating} onClick={() => handleAnnotate("explain")}>
                Explain
              </button>
              <button type="button" disabled={annotating} onClick={() => handleAnnotate("define")}>
                Define
              </button>
              <button type="button" disabled={annotating} onClick={() => handleAnnotate("summarize")}>
                Summarize
              </button>
              <button type="button" disabled={annotating} onClick={handleAsk}>
                Ask Newton
              </button>
            </div>
          )}

          {annotationResult && (
            <div
              className="doc-annotate-popover"
              style={{ top: Math.max(annotationResult.top - 12, 4), left: Math.max(annotationResult.left, 4) }}
              data-testid="doc-annotate-popover"
            >
              <div className="doc-annotate-popover__header">
                <span className="doc-annotate-popover__label">{ANNOTATE_ACTION_LABELS[annotationResult.action]}</span>
                <button
                  type="button"
                  className="doc-annotate-popover__close"
                  aria-label="Dismiss"
                  onClick={() => setAnnotationResult(null)}
                >
                  ×
                </button>
              </div>
              <div className="doc-annotate-popover__text">{annotationResult.text}</div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

interface PdfPagesProps {
  bytes: Uint8Array;
  zoom: number;
  previewRef: React.RefObject<HTMLDivElement | null>;
  onMouseUp: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onFirstPageWidth: (naturalWidth: number) => void;
}

/** Every page of a real PDF, stacked and scrollable — the shape any PDF reader uses,
 * and the one that lets a highlight span page content directly instead of paging
 * through a single-page-at-a-time viewer. `bytes` is the document's own real bytes
 * (the same ones Download saves), never re-derived from the extracted text. */
function PdfPages({ bytes, zoom, previewRef, onMouseUp, onFirstPageWidth }: PdfPagesProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setLoadError(null);
    // pdf.js wants its own copy of the buffer (it may detach/transfer it to the
    // worker) — never hand it the same Uint8Array a re-render or Download might still
    // be holding.
    pdfjsLib
      .getDocument({ data: bytes.slice() })
      .promise.then((doc) => {
        if (!cancelled) setPdf(doc);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't open this PDF.");
      });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (loadError) return <div className="banner banner--error">{loadError}</div>;
  if (!pdf) return <p className="empty-state-text">Loading…</p>;

  return (
    <div className="doc-viewer-panel__pdf-pages" ref={previewRef} onMouseUp={onMouseUp} data-testid="doc-viewer-pdf">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPage key={i} pdf={pdf} pageNumber={i + 1} zoom={zoom} onFirstPageWidth={i === 0 ? onFirstPageWidth : undefined} />
      ))}
    </div>
  );
}

function PdfPage({
  pdf,
  pageNumber,
  zoom,
  onFirstPageWidth,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  onFirstPageWidth?: (naturalWidth: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<import("pdfjs-dist").PDFPageProxy["render"]> | null = null;

    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      onFirstPageWidth?.(page.getViewport({ scale: 1 }).width);

      // Two viewports at the same zoom: `cssViewport` is what's actually shown (the
      // canvas's CSS size, and what the text layer's spans are positioned against);
      // `renderViewport` is only how many pixels the canvas renders internally, denser
      // for a crisp result on a HiDPI display. Rendering straight into `renderViewport`
      // sized CSS pixels (no separate style width/height) is what made 100% zoom
      // overflow the panel in the first pass at this.
      const cssViewport = page.getViewport({ scale: zoom });
      const renderViewport = page.getViewport({ scale: zoom * OUTPUT_SCALE });
      setSize({ width: cssViewport.width, height: cssViewport.height });

      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas && context) {
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;
        canvas.style.width = `${cssViewport.width}px`;
        canvas.style.height = `${cssViewport.height}px`;
        renderTask = page.render({ canvas, canvasContext: context, viewport: renderViewport });
        await renderTask.promise.catch(() => {
          // RenderingCancelledException from a fast zoom change — nothing to show for it.
        });
      }
      if (cancelled) return;

      // The real, positioned, selectable text — what makes highlight-to-annotate
      // possible on a PDF at all (unlike DocumentsPanel's <iframe> preview, which the
      // page can't reach from JS to read a selection out of). Positioned against the
      // CSS viewport, matching what's actually on screen, not the denser render one.
      const textLayerDiv = textLayerRef.current;
      if (textLayerDiv) {
        textLayerDiv.replaceChildren();
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const { TextLayer } = pdfjsLib;
        const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport: cssViewport });
        await textLayer.render().catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, zoom, onFirstPageWidth]);

  return (
    <div className="doc-viewer-panel__page" style={{ width: size.width || undefined, height: size.height || undefined }}>
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer" />
    </div>
  );
}

export default DocumentViewerPanel;
