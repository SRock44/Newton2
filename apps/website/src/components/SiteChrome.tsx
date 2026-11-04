import Link from "next/link";
import { FOOTER_COLUMNS } from "@/lib/siteNav";
import FloatingNav from "./FloatingNav";
import styles from "./SiteChrome.module.css";

/**
 * The header shared by every standalone content route (FAQ/About/Changelog/Roadmap)
 * AND the landing page itself — both now render the same FloatingNav (previously two
 * near-identical ~60-line header blocks kept manually in sync; a nav complex enough to
 * have its own scroll state and mobile menu isn't worth duplicating twice over).
 */
export function SiteHeader() {
  return <FloatingNav />;
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <p className={styles.wordmark}>Newton</p>
          <p className={styles.footerTagline}>Verified, not vibes.</p>
        </div>

        <div className={styles.footerColumns}>
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading} className={styles.footerColumn}>
              <p className={styles.footerColumnHeading}>{column.heading}</p>
              <ul className={styles.footerLinkList}>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className={styles.footerLink}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.footerBottom}>
        <p>&copy; {new Date().getFullYear()} Newton. All rights reserved.</p>
      </div>
    </footer>
  );
}
