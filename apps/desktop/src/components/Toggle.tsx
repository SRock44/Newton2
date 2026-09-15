export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name. Passed straight through to `aria-label` — every current call site
   * already has its own visible text label sitting next to the switch (Composer.tsx's
   * `<span>Learn Mode</span>`, SettingsPanel.tsx's `.settings-toggle-label`), so this is
   * the control's own name for assistive tech, not a rendered label of its own. */
  label: string;
  /** "sm" (Composer.tsx's tight toolbar) vs. "md" (SettingsPanel.tsx's more spacious
   * preferences section, the default) — purely a sizing variant, same track/thumb
   * shape and behavior either way. */
  size?: "sm" | "md";
  /** Learn Mode's own toggle instance gets a little more visual presence than a bare
   * switch would have on its own, per explicit product direction ("such a cool feature"
   * being undercut by a plain checkbox) — a small accent glow around the track while
   * on. Every other toggle in the app (Focus Mode, Study reminders) leaves this off, so
   * Learn Mode reads as distinguished without every switch in the app competing for
   * the same visual weight. */
  emphasized?: boolean;
  className?: string;
}

/** A real accessible pill-style switch — `<button role="switch" aria-checked>` rather
 * than a disguised `<input type="checkbox">`, for full control over the on/off
 * transition animation and correct switch semantics for assistive tech (a checkbox
 * reads as "checked/unchecked," a switch reads as "on/off," which better matches what
 * Learn Mode/Focus Mode actually are: live, behavior-changing settings, not form
 * fields). Styled entirely from this app's existing design tokens (see App.css's
 * `--color-accent`/`--color-border`/`--color-surface` custom properties, already used
 * by `.step-check`/`.checkpoint` and every other themed surface) — no new palette. */
function Toggle({ checked, onChange, disabled, label, size = "md", emphasized, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "toggle",
        `toggle--${size}`,
        checked ? "toggle--checked" : "",
        emphasized ? "toggle--emphasized" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
    </button>
  );
}

export default Toggle;
