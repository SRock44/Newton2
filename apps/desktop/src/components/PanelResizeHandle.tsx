import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

interface PanelResizeHandleProps {
  /** What this handle resizes, e.g. "Resize sidebar" — the accessible name. */
  label: string;
  width: number;
  min: number;
  max: number;
  resizing: boolean;
  onMouseDown: (event: ReactMouseEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

/** The thin grab strip that drags a panel wider or narrower, shared by Sidebar.tsx (on
 * its right edge) and ContextPanel.tsx (on its left). All the behavior lives in
 * lib/usePanelResize.ts; this is only the markup and the ARIA contract.
 *
 * Rendered as a SIBLING of its panel — a flex item of .app-shell — rather than a child:
 * the sidebar is `overflow: hidden` and the context panel scrolls, so an
 * absolutely-positioned child would be clipped or would scroll away from the edge it is
 * supposed to sit on. A negative margin in App.css pulls it back over the panel's
 * border, so the grab target straddles the seam and costs the layout nothing.
 *
 * It's a focusable `separator` with valuenow/min/max, so it's announced as a real
 * resize control and is operable from the keyboard (see usePanelResize's onKeyDown),
 * not a mouse-only affordance. */
function PanelResizeHandle({ label, width, min, max, resizing, onMouseDown, onKeyDown }: PanelResizeHandleProps) {
  return (
    <div
      className={`panel-resize-handle${resizing ? " panel-resize-handle--active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      title="Drag to resize"
    />
  );
}

export default PanelResizeHandle;
