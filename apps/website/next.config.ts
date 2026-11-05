import type { NextConfig } from "next";

// The product lives on ONE origin: this site (marketing pages) AND the real signed-in
// app (apps/web) under the same domain, path-routed (/chat), not two separate ports or
// a separate app.newton.best subdomain. Product owner, verbatim: "it should not be on
// TWO SEPARATE PORTS. IT SHOULD BE LIKE NEWTON.BEST/CHAT."
//
// In development, apps/web runs as its own Vite dev server (for real HMR) — these
// rewrites transparently proxy /chat/* to it, so a browser only ever talks to this one
// origin (localhost:3000), never localhost:5173 directly. In production there is no
// second process to proxy to at all: apps/web has no server-rendering needs (a pure
// client SPA), so its own `vite build` output (base: "/chat/", see apps/web/
// vite.config.ts) gets copied into this app's public/chat/ at deploy time and Next.js
// serves it as plain static files under the same path — see WEBSITE-ROADMAP.md.
const nextConfig: NextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV !== "development") {
      // Production: apps/web's build lives at public/chat/index.html (see this file's
      // own header comment). Next's static file serving matches request paths to real
      // files exactly -- it does NOT do directory-index resolution -- so "/chat" itself
      // (no trailing slash, the exact link every Sign In/Sign Up/Chat Now button on this
      // site points at) would 404 without this, even though "/chat/index.html" and every
      // other file under it resolve fine on their own.
      return [{ source: "/chat", destination: "/chat/index.html" }];
    }
    return [
      // Next's own default trailing-slash normalization (trailingSlash: false, left at
      // its default here — every OTHER route on this site uses that convention) redirects
      // an incoming "/chat/" down to "/chat" before any rewrite runs, so this site is
      // never asked for the trailing-slash form. But apps/web's own Vite dev server, with
      // `base: "/chat/"` (apps/web/vite.config.ts), only serves its index at that exact
      // trailing-slash path — "/chat" alone 404s there. Confirmed both independently (curl
      // directly against 127.0.0.1:5173) before writing this: the destination needs the
      // trailing slash even though the source pattern deliberately doesn't have one.
      { source: "/chat", destination: "http://127.0.0.1:5173/chat/" },
      { source: "/chat/:path*", destination: "http://127.0.0.1:5173/chat/:path*" },
    ];
  },
};

export default nextConfig;
