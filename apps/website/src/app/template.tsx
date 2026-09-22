import styles from "./template.module.css";

// Remounts on every top-level navigation (root-level app/template.tsx — see Next's own
// template.js contract), replaying the CSS enter animation in template.module.css. No
// "use client" needed: the animation is pure CSS keyed off mount, not JS state.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}
