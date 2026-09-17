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
