/**
 * The site's real nav/footer link data — shared between the main landing page
 * (src/app/page.tsx) and every standalone content route (FAQ/About/Changelog/Roadmap)
 * so the two never drift apart. Every entry that isn't a real, live route or in-page
 * anchor is deliberately still "#" (Sign In/Sign Up/Download — Phase 4, not built yet;
 * Contact — no real destination exists), matching this codebase's own established
 * convention of never stubbing a route that doesn't actually exist. See
 * WEBSITE-ROADMAP.md's "Phase 3.6" entry for what these five real routes are and why.
 */

export interface NavLink {
  href: string;
  label: string;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/#verified", label: "Features" },
  { href: "/#for-students", label: "For Students" },
  { href: "/#pro", label: "Pro" },
  { href: "/faq", label: "FAQ" },
];

export const FOOTER_COLUMNS: { heading: string; links: NavLink[] }[] = [
  {
    heading: "Product",
    links: [
      { href: "/#verified", label: "Features" },
      { href: "/#for-students", label: "For Students" },
      { href: "/#pro", label: "Pro" },
      { href: "/roadmap", label: "Roadmap" },
      { href: "#", label: "Download" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "#", label: "Sign In" },
      { href: "#", label: "Sign Up" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/faq", label: "FAQ" },
      { href: "/changelog", label: "Changelog" },
      { href: "#", label: "Contact" },
    ],
  },
];
