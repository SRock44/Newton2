import styles from "./AmbientBackground.module.css";

/**
 * The site's ONE ambient background — rendered once in the root layout, behind every
 * route (including the floating nav, which has no background of its own by design).
 *
 * This replaces what was, across the last two passes, FOUR separately-colored,
 * independently-blurred patches (a body-level `background-attachment: fixed` wash, the
 * floating nav's own glow, and two different per-section aurora layers) — each with its
 * own hard blur-radius edge, which is exactly why they never blended into one field and
 * kept producing visible seams ("doesn't blend with the rest of the gradient"). One
 * source of color, everywhere, can't seam against itself.
 *
 * Deliberately a real `position: fixed` DOM element (not a CSS `background-attachment:
 * fixed` property) and deliberately STATIC, no animation: a real, reported bug
 * ("pages randomly start shaking") traced back to an animated, `inset: -20%`,
 * `filter: blur()` layer — expensive to repaint every frame at that size, and
 * `background-attachment: fixed` specifically is known to force exactly that kind of
 * repaint-on-scroll in several browsers. A static `position: fixed` layer composites
 * once as its own GPU layer and is then just repositioned, never repainted, while
 * scrolling — cheap by construction, not by luck.
 */
export default function AmbientBackground() {
  return (
    <div className={styles.ambient} aria-hidden="true">
      <div className={`${styles.blob} ${styles.blobAccent}`} />
      <div className={`${styles.blob} ${styles.blobAccent2}`} />
      <div className={`${styles.blob} ${styles.blobAccent3}`} />
    </div>
  );
}
