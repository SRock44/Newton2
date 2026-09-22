import type { ReactNode } from "react";
import { SiteHeader, SiteFooter } from "./SiteChrome";
import styles from "./ContentPage.module.css";

/**
 * The shared page shell for every standalone content route (FAQ/About/Changelog/
 * Roadmap): skip link + sticky header + a `<main>` landmark + footer, matching the
 * landing page's own top-level structure (src/app/page.tsx) so these routes read as
 * the same site, not a bolted-on subsection.
 */
export function ContentPage({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className={styles.main}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** The eyebrow/title/subtitle intro block every content route opens with. */
export function ContentHero({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className={styles.hero}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.title}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </div>
  );
}
