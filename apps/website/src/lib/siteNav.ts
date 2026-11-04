/**
 * The site's real nav/footer link data — shared between the main landing page
 * (src/app/page.tsx) and every standalone content route (FAQ/About/Changelog/Roadmap)
 * so the two never drift apart. Download is now a real route (/download, a real page
 * listing real GitHub Release assets — see that route's own file). Contact still has no
 * real destination and stays "#", matching this codebase's own established convention of
 * never stubbing a route that doesn't actually exist. Sign In/Sign Up aren't in this
 * list — see env.ts's appAuthUrl, used directly where those render (the header/footer
 * JSX, not this shared data) since they're computed, not static hrefs.
 *
 * Phase 3.8: "For Students" dropped (the section it pointed to was cut as redundant
 * with the feature list). The footer's "Product" column no longer repeats the primary
 * nav's Features/Pro links, and the old "Account" column is gone — Sign In/Sign Up
 * already live in the header, so the footer doesn't need to say them again.
 */

export interface NavLink {
  href: string;
  label: string;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/#features", label: "Features" },
  { href: "/#pro", label: "Pro" },
  { href: "/faq", label: "FAQ" },
];

export const FOOTER_COLUMNS: { heading: string; links: NavLink[] }[] = [
  {
    heading: "Product",
    links: [
      { href: "/roadmap", label: "Roadmap" },
      { href: "/download", label: "Download" },
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
