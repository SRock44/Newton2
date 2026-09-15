import { useEffect, useRef } from "react";

/** The slice of MathfieldElement's real API this wrapper actually touches — kept
 * intentionally small and structural (rather than importing MathLive's own
 * `MathfieldElement` type) since the element is created via `document.createElement`,
 * not JSX, so nothing here needs the full type surface. */
interface MathFieldEl extends HTMLElement {
  value: string;
  disabled: boolean;
}

/** Registers the `<math-field>` custom element (https://cortexjs.io/mathlive/) and, in
 * a real browser, the `window.mathVirtualKeyboard` singleton the "show keyboard" button
 * below drives. Dynamically imported (not a static top-level `import "mathlive"`) —
 * same "don't make every chat session download a library only Learn Mode's step-check
 * needs" reasoning `PlotlyFigure.tsx`'s `loadPlotly()` already established for Plotly:
 * MathLive is a real, non-trivial bundle, and most chat turns never render a math
 * field at all. */
function loadMathlive(): Promise<void> {
  return import("mathlive").then(() => undefined);
}

export interface MathInputProps {
  /** Current LaTeX value. Kept in sync onto the underlying `<math-field>` whenever it
   * changes from *outside* (e.g. a parent clearing the draft after submit) — see the
   * dedicated sync effect below, which only writes `.value` when it actually differs
   * from what the field already holds, so a normal keystroke round-trip through the
   * parent's own state never clobbers the caret mid-edit. */
  value: string;
  /** Fired on every MathLive `input` event with the field's current LaTeX — i.e. on
   * essentially every keystroke/virtual-keyboard tap, same granularity as a plain
   * `<input>`'s onChange. */
  onChange: (latex: string) => void;
  /** Fired when Enter is pressed inside the field (mirrors StepCheck's old plain-input
   * Enter-to-submit behavior). Optional — omit for a field with no single-line submit
   * affordance. */
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Accessible name — there's no visible `<label>` at any of this component's call
   * sites, same as the plain-text inputs it replaces. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Wraps MathLive's `<math-field>` web component: a WYSIWYG math input that renders
 * real math glyphs live as the student types and ships a built-in virtual math
 * keyboard (sqrt/exponent/fraction/integral/sum/Greek-letter panels), instead of
 * making them type raw caret/asterisk LaTeX into a plain text box. Speaks LaTeX in/out,
 * which round-trips directly through this app's existing remark-math/rehype-katex
 * pipeline (see MessageContent.tsx) once wrapped as `$...$`.
 *
 * `<math-field>` is a custom element, not a standard controlled input — React doesn't
 * know how to diff a `value` prop onto it the way it does a real `<input>`. So this
 * creates the element imperatively via `document.createElement` and drives it by ref,
 * the same "imperative library inside a ref'd container" shape `PlotlyFigure.tsx` uses
 * for Plotly — and listens for MathLive's own `input`/`keydown` events rather than
 * relying on a React synthetic-event prop the custom element wouldn't fire correctly.
 */
function MathInput({ value, onChange, onSubmit, placeholder, disabled, ariaLabel, className }: MathInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathFieldEl | null>(null);
  // Refs, not deps, for everything the one-time mount effect below needs — the field
  // element is created exactly once (after the lazy `import("mathlive")` resolves);
  // re-running creation to pick up a fresh prop/closure on every parent render would
  // tear down and recreate the whole field (losing focus/caret position, and re-
  // downloading nothing further, but still wasteful) for no behavioral benefit. Reading
  // through a ref at creation time (rather than closing over the mount-time prop value)
  // also means a prop change that lands *during* the brief async-load window is never
  // silently dropped.
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const valueRef = useRef(value);
  const placeholderRef = useRef(placeholder);
  const disabledRef = useRef(disabled);
  const ariaLabelRef = useRef(ariaLabel);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  valueRef.current = value;
  placeholderRef.current = placeholder;
  disabledRef.current = disabled;
  ariaLabelRef.current = ariaLabel;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let field: MathFieldEl | null = null;
    let handleInput: (() => void) | null = null;
    let handleKeyDown: ((e: KeyboardEvent) => void) | null = null;

    loadMathlive().then(() => {
      if (cancelled || !containerRef.current) return;

      field = document.createElement("math-field") as MathFieldEl;
      field.className = "math-input__field";
      // "manual" (rather than the default "auto") means the virtual keyboard never
      // pops open unrequested on this desktop app — it's surfaced only via the
      // explicit "Show math keyboard" button below, more predictable on a mouse/
      // keyboard platform than MathLive's touch-oriented auto-show heuristic.
      field.setAttribute("math-virtual-keyboard-policy", "manual");
      if (ariaLabelRef.current) field.setAttribute("aria-label", ariaLabelRef.current);
      // MathLive's own internal accessibility is real but shadow-DOM-internal; an
      // explicit host-level role keeps this field reachable the same way as every
      // other plain-text field in this app (`getByRole("textbox", { name: ... })`).
      field.setAttribute("role", "textbox");
      field.setAttribute("placeholder", placeholderRef.current ?? "");
      field.value = valueRef.current;
      field.disabled = Boolean(disabledRef.current);

      handleInput = () => onChangeRef.current(field!.value);
      handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmitRef.current?.();
        }
      };
      field.addEventListener("input", handleInput);
      field.addEventListener("keydown", handleKeyDown);

      containerRef.current.appendChild(field);
      fieldRef.current = field;
    });

    return () => {
      cancelled = true;
      if (field) {
        if (handleInput) field.removeEventListener("input", handleInput);
        if (handleKeyDown) field.removeEventListener("keydown", handleKeyDown);
        container.removeChild(field);
      }
      fieldRef.current = null;
    };
    // Intentionally empty — see the ref comment above for why this must run exactly
    // once rather than on every prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Post-mount sync — no-ops harmlessly while the field hasn't finished loading yet
  // (fieldRef.current is still null), same as PlotlyFigure.tsx's own loading-guard
  // pattern; the values above are what actually apply once it does load.
  useEffect(() => {
    const field = fieldRef.current;
    if (field && field.value !== value) field.value = value;
  }, [value]);

  useEffect(() => {
    fieldRef.current?.setAttribute("placeholder", placeholder ?? "");
  }, [placeholder]);

  useEffect(() => {
    const field = fieldRef.current;
    if (field) field.disabled = Boolean(disabled);
  }, [disabled]);

  function showKeyboard() {
    fieldRef.current?.focus();
    // Only present in a real browser with MathLive fully loaded — never in the mocked
    // test boundary (see MathInput.test.tsx), so this is deliberately optional-chained
    // rather than assumed to exist.
    window.mathVirtualKeyboard?.show?.({ animate: true });
  }

  return (
    <div className={`math-input${className ? ` ${className}` : ""}`}>
      <div className="math-input__field-wrap" ref={containerRef} />
      <button
        type="button"
        className="math-input__keyboard-toggle"
        onClick={showKeyboard}
        disabled={disabled}
        aria-label="Show math keyboard"
        title="Show math keyboard"
      >
        ⌨
      </button>
    </div>
  );
}

export default MathInput;
