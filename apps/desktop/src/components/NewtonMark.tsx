import { useId } from "react";

interface NewtonMarkProps {
  size?: number;
  className?: string;
}

/** The app's brand mark — an abstract orbit (a tilted ellipse with a lit body at its
 * center and a glowing satellite riding its path), reused everywhere "Newton" needs a
 * small icon: the title bar, the sidebar header, the login screen, and the chat empty
 * state. Deliberately not a literal apple or a letter "N" in a box — those read as
 * generic placeholder branding.
 *
 * "Perihelion" revision (2026-10-01, product owner design review): the original was a
 * single flat `currentColor` line-and-dot, which read as a thin grey ring the instant it
 * got small. This version has real depth (a radial-gradient sphere instead of a flat
 * disc) and a warm gold satellite with its own glow instead of a second flat dot.
 * Deliberately fixed brand colors (not `currentColor`, not tied to the app's selectable
 * accent theme or light/dark mode) — picked from the design review's "on dusk" rendering
 * specifically because the product owner preferred it there, and a logo having one
 * constant identity regardless of the surrounding UI theme is the normal case for a
 * brand mark, not an oversight. `useId()` keeps this collision-safe when several
 * instances render on the same page at once (title bar + sidebar + empty state, all real
 * cases in this app) — SVG gradient ids are global to the document, not scoped per
 * `<svg>`.
 *
 * The orbit ring is a flat, uniform stroke on purpose, not a fade. A first version tried
 * a comet-trail effect (a linear gradient fading in toward the satellite) and it read as
 * a real bug, not a design choice: a linear gradient fades along ONE straight direction,
 * not angularly around the ellipse, so parts of the ring on the opposite VISUAL side
 * could still land in the high-opacity band depending on where they projected onto that
 * line — the left side of the ring came out looking patchy/too-dark at every size, small
 * or large, instead of cleanly fading. A true per-point angular fade needs an arc
 * gradient SVG doesn't have a primitive for; a flat stroke is honest and reads correctly
 * at every size instead of looking broken at most of them. */
function NewtonMark({ size = 20, className }: NewtonMarkProps) {
  const uid = useId();
  const bodyId = `${uid}-body`;
  const glowId = `${uid}-glow`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={bodyId} cx="34%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#9fb8ee" />
          <stop offset="50%" stopColor="#7c9de8" />
          <stop offset="100%" stopColor="#4f6bb0" />
        </radialGradient>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e0a94e" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#e0a94e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        cx="12"
        cy="12"
        rx="9.2"
        ry="4.6"
        transform="rotate(-20 12 12)"
        stroke="#7c9de8"
        strokeOpacity="0.65"
        strokeWidth="1.6"
      />
      <circle cx="19.3" cy="7.7" r="3.4" fill={`url(#${glowId})`} />
      <circle cx="12" cy="12" r="4.7" fill={`url(#${bodyId})`} />
      <circle cx="19.3" cy="7.7" r="1.5" fill="#e0a94e" />
    </svg>
  );
}

export default NewtonMark;
