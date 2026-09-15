/**
 * Retargets MathLive's `mathVirtualKeyboard` singleton away from its default
 * page-level fixed overlay (appended to `document.body`, styled by MathLive's own
 * `body > .ML__keyboard { position: fixed }` rule — confirmed by reading the actually-
 * installed mathlive@0.110.0 package's own bundled CSS, not assumed from general
 * knowledge) and onto a dedicated element in this app's own layout instead: the
 * `#math-keyboard-dock` div App.tsx renders as a flex sibling of `.chat-pane` and
 * `.composer` inside `.main-pane` (see App.css's ".math-keyboard-dock" rules).
 *
 * Why this is the real fix, not a workaround: MathLive's `VirtualKeyboardOptions.
 * container` setter ("Element the virtual keyboard element gets appended to... Default:
 * document.body" — see node_modules/mathlive/types/virtual-keyboard.d.ts) is the
 * actual documented mechanism for this. The installed version has no true *per-field*
 * anchoring API (confirmed by reading VirtualKeyboardInterface/VirtualKeyboardOptions
 * in full) — `container` is necessarily app-wide, since `mathVirtualKeyboard` is a
 * single page-level singleton shared by every `<math-field>`. Anchoring it at this
 * app's main chat column (rather than `document.body`) is the correct level of
 * scoping actually available: normal flex document flow means showing the keyboard
 * pushes the Composer down instead of ever covering it, and the keyboard is naturally
 * confined to the chat column's width rather than the whole window.
 *
 * `mathVirtualKeyboard.visible` and its `"virtual-keyboard-toggle"` event are also
 * real, typed API (`window.mathVirtualKeyboard: VirtualKeyboardInterface &
 * EventTarget` in mathlive.d.ts) — used here to toggle `.math-keyboard-dock--visible`
 * so the dock only takes up real layout space while the keyboard is actually shown,
 * however it ends up getting hidden (this button, MathLive's own in-keyboard hide
 * button, Escape, clicking outside, ...) rather than only reacting to this app's own
 * "show" call.
 */
export const MATH_KEYBOARD_DOCK_ID = "math-keyboard-dock";
const DOCK_VISIBLE_CLASS = "math-keyboard-dock--visible";

let wired = false;

/** Idempotent and safe to call from every MathInput mount — real work happens at most
 * once per page load. No-ops quietly if `mathVirtualKeyboard` isn't present (the
 * mocked-`mathlive` test boundary — see MathInput.test.tsx) or the dock element hasn't
 * rendered yet (retried on the next MathInput mount rather than throwing). */
export function setupMathKeyboardDock(): void {
  if (wired) return;
  const kb = window.mathVirtualKeyboard;
  if (!kb) return;
  const dock = document.getElementById(MATH_KEYBOARD_DOCK_ID);
  if (!dock) return;

  kb.container = dock;
  const syncVisibility = () => dock.classList.toggle(DOCK_VISIBLE_CLASS, kb.visible);
  kb.addEventListener("virtual-keyboard-toggle", syncVisibility);
  syncVisibility();
  wired = true;
}
