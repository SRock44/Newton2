/** Best-effort OS check for picking OS-native window-chrome conventions (traffic
 * lights vs. the Windows-style minimize/maximize/close cluster). `navigator.platform`
 * is deprecated but every WebKit/Chromium-based webview still reports it accurately --
 * including the WKWebView Tauri renders in on macOS, where it reports "MacIntel" --
 * and jsdom always reports "" regardless of the host OS running the test, so this
 * stays deterministic under the test runner no matter what machine runs it. */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toLowerCase().startsWith("mac");
}
