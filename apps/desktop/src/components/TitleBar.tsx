import { useEffect, useState } from "react";
import NewtonMark from "./NewtonMark";
import { isMacPlatform } from "../lib/platform";

type TitleBarVariant = "main" | "notepad";

interface TitleBarProps {
  title: string;
  variant?: TitleBarVariant;
}

/** Custom-drawn window chrome, replacing the native OS title bar entirely (see
 * src-tauri/tauri.conf.json's `decorations: false` on the main window, and
 * `show_notepad_window`'s `.decorations(false)` on the Notepad window — both windows
 * render this same component so neither ever shows a mix of native and custom chrome).
 *
 * Every button here calls the real Tauri window API, dynamically imported the same
 * defensive way the rest of the app imports `@tauri-apps/api/event` (see App.tsx) — so
 * this also renders harmlessly under the jsdom test runner, which has no real Tauri
 * bridge for `getCurrentWindow()` to attach to.
 *
 * Only `.titlebar-brand`'s background is a Tauri drag region (`data-tauri-drag-region`)
 * — Tauri only treats the exact element under the pointer as a drag handle, not its
 * descendants, so the buttons in `.titlebar-controls` (which never carry that attribute)
 * stay independently clickable without any extra `stopPropagation` plumbing. */
function TitleBar({ title, variant = "main" }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  // Keep the maximize/restore icon in sync with real window state — not just
  // optimistic-toggled on click, since the window can also be maximized/restored by the
  // OS (double-clicking the drag region, a Windows snap gesture, etc).
  useEffect(() => {
    if (variant !== "main") return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        const syncMaximized = () => {
          win
            .isMaximized()
            .then((max) => {
              if (!cancelled) setIsMaximized(max);
            })
            .catch(() => {
              // No real window to query under this runtime.
            });
        };
        syncMaximized();
        return win.onResized(syncMaximized);
      })
      .then((off) => {
        if (cancelled) off?.();
        else unlisten = off;
      })
      .catch(() => {
        // No Tauri context (e.g. this file under a test runner) — nothing to sync.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [variant]);

  async function handleMinimize() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (err) {
      // Under jsdom (no real Tauri bridge) this is expected and silent. In a real
      // window it means something is actually broken (e.g. a missing ACL permission
      // in src-tauri/capabilities/*.json) — log it instead of failing invisibly.
      console.error("TitleBar: minimize failed", err);
    }
  }

  async function handleToggleMaximize() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
    } catch (err) {
      console.error("TitleBar: toggleMaximize failed", err);
    }
  }

  async function handleClose() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (err) {
      console.error("TitleBar: close failed", err);
    }
  }

  // macOS convention puts window controls as three colored "traffic light" dots in the
  // top-left corner, ordered close/minimize/zoom, with their glyphs hidden until hover --
  // never a right-aligned min/max/close cluster with permanently visible icons, which
  // reads as distinctly Windows to a Mac user. The title is centered rather than
  // left-anchored next to the brand mark, matching how native macOS title bars center
  // the window title regardless of where the traffic lights sit.
  if (isMacPlatform()) {
    return (
      <div className="titlebar titlebar--mac" data-tauri-drag-region>
        <div className="titlebar-traffic-lights">
          <button
            type="button"
            className="traffic-light traffic-light--close"
            aria-label="Close"
            onClick={handleClose}
          >
            <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" className="traffic-light-glyph">
              <line x1="0.6" y1="0.6" x2="5.4" y2="5.4" stroke="#4d0000" strokeWidth="1" strokeLinecap="round" />
              <line x1="5.4" y1="0.6" x2="0.6" y2="5.4" stroke="#4d0000" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            className="traffic-light traffic-light--minimize"
            aria-label="Minimize"
            onClick={handleMinimize}
          >
            <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" className="traffic-light-glyph">
              <line x1="0.6" y1="3" x2="5.4" y2="3" stroke="#7a4b00" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </button>

          {variant === "main" && (
            <button
              type="button"
              className="traffic-light traffic-light--zoom"
              aria-label={isMaximized ? "Restore" : "Maximize"}
              onClick={handleToggleMaximize}
            >
              <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" className="traffic-light-glyph">
                <path d="M0.6 3.6L2.4 3.6L2.4 5.4Z" fill="#00591c" />
                <path d="M5.4 2.4L3.6 2.4L3.6 0.6Z" fill="#00591c" />
              </svg>
            </button>
          )}
        </div>

        <div className="titlebar-brand titlebar-brand--center" data-tauri-drag-region>
          <span className="titlebar-mark">
            <NewtonMark size={13} />
          </span>
          <span className="titlebar-title">{title}</span>
        </div>

        {/* Balances the traffic-lights group's width so the title above lands
            optically centered in the bar rather than centered minus that offset.
            Matches .titlebar-traffic-lights' actual width for each variant: 20px
            padding + 12px per dot + 8px gap between dots, on both sides. */}
        <div
          className="titlebar-spacer"
          data-tauri-drag-region
          aria-hidden="true"
          style={{ width: variant === "main" ? 92 : 72 }}
        />
      </div>
    );
  }

  return (
    // The drag region now covers the whole bar, not just the brand's icon+title —
    // previously only that narrow left-hand area was draggable/double-click-to-maximize,
    // leaving most of the bar (the empty space between the title and the buttons) dead.
    // Safe to also mark the container even though it structurally contains the control
    // buttons: Tauri's drag-region handling matches the *exact* element under the
    // pointer, not any ancestor, so a mousedown that starts directly on a button (which
    // never carries this attribute itself) is never mistaken for a drag start.
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <span className="titlebar-mark">
          <NewtonMark size={13} />
        </span>
        <span className="titlebar-title">{title}</span>
      </div>

      <div className="titlebar-controls">
        <button type="button" className="titlebar-btn" aria-label="Minimize" onClick={handleMinimize}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>

        {variant === "main" && (
          <button
            type="button"
            className="titlebar-btn"
            aria-label={isMaximized ? "Restore" : "Maximize"}
            onClick={handleToggleMaximize}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="2.5" y="0.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
                <path d="M0.5 2.5H6.5V8.5H0.5V2.5Z" fill="var(--color-sidebar)" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
        )}

        <button
          type="button"
          className="titlebar-btn titlebar-btn--close"
          aria-label="Close"
          onClick={handleClose}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.1" />
            <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
