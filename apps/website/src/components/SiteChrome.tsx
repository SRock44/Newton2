"use client";

import Link from "next/link";
import { NAV_LINKS, FOOTER_COLUMNS } from "@/lib/siteNav";
import styles from "./SiteChrome.module.css";

/**
 * The header/footer chrome shared by every standalone content route (FAQ/About/
 * Changelog/Roadmap) — visually identical to the header/footer built inline in
 * src/app/page.tsx (same tokens, same wordmark-apple hover easter egg, same nav/footer
 * link data via src/lib/siteNav.ts), just factored out so four new routes don't each
 * duplicate ~120 lines of near-identical header/footer JSX. The landing page itself
 * (page.tsx) keeps its own inline header/footer untouched — this component is
 * deliberately NOT swapped in there, to avoid touching page.tsx's hero/demo/"Verified,
 * not vibes" region, which another pass owns.
 */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <span className={styles.wordmarkWrap}>
          <Link href="/" className={styles.wordmark}>
            Newton
          </Link>
          <span className={styles.wordmarkApple} aria-hidden="true">
            🍎
          </span>
        </span>

        <nav className={styles.nav} aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link key={link.label} href={link.href} className={styles.navLink}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={styles.headerActions}>
          <a href="#" className={styles.navLinkAuth}>
            Sign In
          </a>
          <a href="#" className={styles.btnPrimarySm}>
            Sign Up
          </a>
        </div>
      </div>
    </header>
  );
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
