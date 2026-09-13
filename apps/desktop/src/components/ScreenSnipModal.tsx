import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

interface ScreenSnipModalProps {
  dataUrl: string;
  onCancel: () => void;
  onCapture: (file: File) => void;
}

interface Point {
  x: number;
  y: number;
}

const MIN_SELECTION_SIZE = 6;

function rectFromPoints(a: Point, b: Point) {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Shown after a "Newton Snip" screen capture (hotkey or tray) hands the frontend a full
 * screenshot — lets the student drag-select just the region they actually want (a single
 * problem, not the whole screen) before it's cropped and sent into chat through the same
 * image-attachment path Composer already uses. */
function ScreenSnipModal({ dataUrl, onCancel, onCapture }: ScreenSnipModalProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const selection = dragStart && dragEnd ? rectFromPoints(dragStart, dragEnd) : null;
  const hasValidSelection =
    !!selection && selection.width >= MIN_SELECTION_SIZE && selection.height >= MIN_SELECTION_SIZE;

  function pointFromEvent(e: ReactMouseEvent): Point | null {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
    };
  }

  function handleMouseDown(e: ReactMouseEvent) {
    const point = pointFromEvent(e);
    if (!point) return;
    setIsDragging(true);
    setDragStart(point);
    setDragEnd(point);
  }

  function handleMouseMove(e: ReactMouseEvent) {
    if (!isDragging) return;
    const point = pointFromEvent(e);
    if (point) setDragEnd(point);
  }

  async function handleSend() {
    const img = imgRef.current;
    if (!img || !hasValidSelection || !selection) return;

    // The image is displayed at its CSS-constrained size, but must be cropped from the
    // full-resolution screenshot — scale the selection rect from displayed to natural
    // pixels before drawing it into the crop canvas.
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const sx = selection.left * scaleX;
    const sy = selection.top * scaleY;
    const sw = selection.width * scaleX;
    const sh = selection.height * scaleY;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    setCapturing(true);
    canvas.toBlob((blob) => {
      setCapturing(false);
      if (!blob) return;
      onCapture(new File([blob], "newton-snip.png", { type: "image/png" }));
    }, "image/png");
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="screen-snip"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Select a region to send to Newton"
      >
        <div className="screen-snip__header">
          <h2>Newton Snip</h2>
          <p>Drag to select the part of the screen you want Newton to look at.</p>
        </div>

        <div
          className="screen-snip__stage"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={() => setIsDragging(false)}
        >
          <img ref={imgRef} src={dataUrl} alt="Screen capture" className="screen-snip__image" draggable={false} />
          {selection && (
            <div
              className="screen-snip__selection"
              style={{
                left: selection.left,
                top: selection.top,
                width: selection.width,
                height: selection.height,
              }}
            />
          )}
        </div>

        <div className="screen-snip__actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSend}
            disabled={!hasValidSelection || capturing}
          >
            {capturing ? "Sending…" : "Send to Newton"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ScreenSnipModal;
