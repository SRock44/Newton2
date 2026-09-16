import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { clampPanelWidth } from "./preferences";

/** Plain mouse-event drag-to-resize for the two flanking panels (Sidebar.tsx's right
 * edge, ContextPanel.tsx's left edge) — deliberately no new dependency, since this is
 * ~40 lines of pointer bookkeeping and nothing a library would do better here.
 *
 * `direction` is which way "wider" is from the handle's point of view: the sidebar sits
 * on the left, so dragging its handle RIGHT (+x) makes it wider (`1`); the context panel
 * sits on the right, so dragging its handle right makes it NARROWER (`-1`).
 *
 * The live width is React state (so the panel tracks the cursor), but it's only
 * persisted on mouseup — dragging across 300px shouldn't mean 300 localStorage writes.
 * A ref shadows the state because the mousemove listener closes over its creation-time
 * render and would otherwise read a stale width. */
export function usePanelResize(options: {
  /** The panel's current (persisted) width, used once to seed state. */
  initial: number;
  /** The shipped default, which the Home key snaps back to. */
  defaultWidth: number;
  min: number;
  max: number;
  direction: 1 | -1;
  persist: (width: number) => void;
}) {
  const { initial, defaultWidth, min, max, direction, persist } = options;
  const [width, setWidthState] = useState(() => clampPanelWidth(initial, min, max));
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clampPanelWidth(next, min, max);
      widthRef.current = clamped;
      setWidthState(clamped);
      return clamped;
    },
    [min, max],
  );

  const onMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      // Only a primary-button drag resizes; a right-click on the hairline handle should
      // fall through to the app's own context menu, not start a phantom drag.
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthRef.current;
      setResizing(true);

      function handleMove(moveEvent: MouseEvent) {
        setWidth(startWidth + (moveEvent.clientX - startX) * direction);
      }

      function handleUp() {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        setResizing(false);
        persist(widthRef.current);
      }

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [direction, persist, setWidth],
  );

  /** Keyboard equivalent, so the handle isn't a mouse-only control: the handle is a
   * focusable `separator`, and Left/Right nudge it by one step (Shift for a coarse
   * jump), Home resets to the default. Persisted immediately — a keypress is a discrete
   * commit, unlike a continuous drag. */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const step = event.shiftKey ? 32 : 8;
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = widthRef.current - step * direction;
      else if (event.key === "ArrowRight") next = widthRef.current + step * direction;
      else if (event.key === "Home") next = defaultWidth;
      if (next === null) return;
      event.preventDefault();
      persist(setWidth(next));
    },
    [direction, defaultWidth, persist, setWidth],
  );

  // While a drag is in flight the cursor must stay col-resize and text selection must
  // stay off even as the pointer leaves the 5px handle — which it does immediately.
  // A body-level class is the only thing that covers the whole window.
  useEffect(() => {
    if (!resizing) return;
    document.body.classList.add("is-resizing-panel");
    return () => document.body.classList.remove("is-resizing-panel");
  }, [resizing]);

  return { width, resizing, onMouseDown, onKeyDown };
}
