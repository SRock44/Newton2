"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { NAV_LINKS } from "@/lib/siteNav";
import { appAuthUrl } from "@/lib/env";
import { redirectToSignIn } from "@/lib/authRedirect";
import styles from "./FloatingNav.module.css";

/** A tight hamburger icon for the mobile nav toggle — plain spans, not SVG, so the
 * bars can animate into an X with CSS alone when open. */
function MenuIcon({ open }: { open: boolean }) {
  return (
    <span className={`${styles.menuToggleBars} ${open ? styles.menuToggleBarsOpen : ""}`} aria-hidden="true">
      <span className={styles.menuToggleBar} />
      <span className={styles.menuToggleBar} />
      <span className={styles.menuToggleBar} />
    </span>
  );
}

/**
 * The site's one real primary nav — shared by the landing page and every standalone
 * content route (previously two near-identical header blocks; see SiteChrome.tsx's own
 * comment for why they're consolidated now). A floating glass pill, not a full-width
 * bar bolted to the viewport edge: it solidifies slightly once the page scrolls past it
 * (see `scrolled`), and the wordmark's "Newton's apple" hover easter egg is treated as
 * a real piece of the brand's identity rather than a buried console-log hint — see the
 * fall/bounce animation in FloatingNav.module.css.
 */
export default function FloatingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 8);
        raf = 0;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Real `appAuthUrl` href kept as the fallback — JS-disabled visitors and a
  // middle-click/ctrl-click "open in new tab" (which bypasses onClick entirely) still
  // get a working, if slower, path straight through apps/web. See authRedirect.ts's
  // own comment for the ~650ms stop at /chat this skips for everyone else.
  function handleAuthClick(mode: "login" | "register") {
    return (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      void redirectToSignIn(mode);
    };
  }

  return (
    <div className={styles.navOuter}>
      <div className={`${styles.navBar} ${scrolled ? styles.navBarScrolled : ""}`}>
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
          <a href={appAuthUrl("login")} className={styles.navLinkAuth} onClick={handleAuthClick("login")}>
            Sign In
          </a>
          <a href={appAuthUrl("register")} className={styles.btnPrimarySm} onClick={handleAuthClick("register")}>
            Sign Up
          </a>
          <button
            type="button"
            className={styles.menuToggle}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <MenuIcon open={mobileMenuOpen} />
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <nav id="mobile-nav" className={styles.mobileNav} aria-label="Mobile">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className={styles.mobileNavLink}
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <a
            href={appAuthUrl("login")}
            className={styles.mobileNavLink}
            onClick={(e) => {
              handleAuthClick("login")(e);
              setMobileMenuOpen(false);
            }}
          >
            Sign In
          </a>
          <a
            href={appAuthUrl("register")}
            className={styles.mobileNavLinkPrimary}
            onClick={(e) => {
              handleAuthClick("register")(e);
              setMobileMenuOpen(false);
            }}
          >
            Sign Up
          </a>
        </nav>
      )}
    </div>
  );
}
