/** Best-effort OS check for picking OS-native window-chrome conventions (traffic
 * lights vs. the Windows-style minimize/maximize/close cluster). `navigator.platform`
 * is deprecated but every WebKit/Chromium-based webview still reports it accurately --
 * including the WKWebView Tauri renders in on macOS, where it reports "MacIntel" --
 * and jsdom always reports "" regardless of the host OS running the test, so this
 * stays deterministic under the test runner no matter what machine runs it.
 *
 * One real spoofing case this guards against: iPadOS's "Desktop site" mode reports
 * `navigator.platform` as "MacIntel" too, even though it's a real touchscreen. A real
 * Mac has no touch digitizer at all (`maxTouchPoints` is 0), so requiring that
 * alongside the platform string is Apple's own documented technique for telling a real
 * Mac apart from an iPad pretending to be one. `?? 0` treats a missing property (jsdom,
 * or any environment that doesn't implement it) the same as "not a touch device" rather
 * than failing the check. No mobile build of this app ships today, so this has no
 * observable effect yet -- it's here so a future one doesn't silently inherit it. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!navigator.platform.toLowerCase().startsWith("mac")) return false;
  return (navigator.maxTouchPoints ?? 0) <= 1;
}

/** True when this bundle is running inside the Tauri desktop shell (a real IPC bridge
 * injected into the webview), false in a plain browser tab — the one seam every
 * platform-specific capability (window chrome, native save/notification dialogs,
 * deep-link OAuth) branches on. `apps/web` loads this exact same `src/` tree (see
 * apps/web/README or its vite config's alias) with no bridge present, so this must check
 * for the bridge itself rather than a build-time flag, the same way `isNotepadWindow()`
 * in main.tsx already probes `getCurrentWindow()` and falls back cleanly when it fails —
 * this is that same fallback, made reusable and checked up front instead of discovered
 * via a caught exception. `__TAURI_INTERNALS__` is the object every `@tauri-apps/api`
 * call actually goes through; checking for it (not the older, deprecated
 * `__TAURI__` global) matches what Tauri 2's own JS packages check internally. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Opens a URL in a new top-level browsing context — the system browser under Tauri
 * (`@tauri-apps/plugin-opener`, used for Stripe Checkout/billing-portal and Google
 * Classroom's OAuth consent screen, both external domains the in-app webview should
 * never navigate itself into), a new tab under a plain browser (`window.open`, the
 * closest web equivalent — the student stays on the Newton tab in the background,
 * exactly like the desktop app stays open behind the system browser). Both call sites
 * already poll the backend for the resulting state change afterward rather than relying
 * on any redirect-back, so neither path needs to report success/failure beyond throwing
 * if nothing could be opened at all. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    throw new Error("Couldn't open the browser — it may have been blocked by a pop-up blocker.");
  }
}
