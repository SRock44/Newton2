import { useEffect, useState } from "react";
import NewtonMark from "./NewtonMark";

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
    } catch {
      // No Tauri context.
    }
  }

  async function handleToggleMaximize() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
    } catch {
      // No Tauri context.
    }
  }

  async function handleClose() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      // No Tauri context.
    }
  }

  return (
    <div className="titlebar">
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
