import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/desktop's own installed node_modules — NOT a second copy. See src/main.tsx's
// comment and apps/desktop/src/bootstrap.tsx's for the full reasoning: every file this
// app actually runs is either physically inside apps/desktop/src (so its own bare
// imports resolve against apps/desktop/node_modules automatically, with zero aliasing
// needed) or is one of the two files below for which that automatic resolution doesn't
// apply, because they're physically inside apps/web/src instead.
const desktopRoot = path.resolve(__dirname, "../desktop");

// https://vite.dev/config/
export default defineConfig({
  // The product lives on ONE origin, not a separate port/subdomain for "the app" vs the
  // marketing site (apps/website) — product owner, verbatim: "it should not be on TWO
  // SEPARATE PORTS... NEWTON.BEST/CHAT." This is that one fixed mount path: Next.js
  // (apps/website/next.config.ts) proxies /chat/* to this dev server in development, and
  // serves this app's own production build as static files under the same path in
  // production (see WEBSITE-ROADMAP.md) — either way, a browser only ever sees one
  // origin. auth.ts's webRedirectUri() is hardcoded to match this exact path.
  base: "/chat/",
  plugins: [react()],
  resolve: {
    alias: {
      // The one place two separate copies would actually break something (React's hook
      // dispatcher is a module-singleton) rather than just waste disk space — apps/web
      // has no react/react-dom of its own (see package.json) specifically so there is
      // only ever one possible copy to resolve to here, never a choice to get wrong.
      react: path.resolve(desktopRoot, "node_modules/react"),
      "react-dom": path.resolve(desktopRoot, "node_modules/react-dom"),
    },
  },
  server: {
    // Vite's own conventional default — pinned explicitly (rather than left to "whatever
    // port happens to be free") so apps/website's next.config.ts rewrite can proxy to one
    // fixed destination.
    port: 5173,
    // Explicit IPv4 loopback, not left to Vite's own "localhost" default resolution —
    // the exact same ambiguity apps/desktop/src's own vite.config.ts already documents
    // and works around: on this machine that resolution landed on IPv6-only (`::1`), so
    // Next.js's rewrite destination (next.config.ts, a literal `127.0.0.1:5173`) got a
    // real, 100%-reproducible ECONNREFUSED/500 — confirmed via `netstat` (listening on
    // `[::1]:5173`, zero IPv4 listener) before adding this. Pinning it removes the
    // ambiguity outright, same fix, same reason.
    host: "127.0.0.1",
    // Vite refuses to serve files outside the project root by default (a real security
    // boundary for anything serving someone else's files) — apps/web's entire premise is
    // serving apps/desktop/src's own files, so that root has to be explicitly allowed.
    fs: { allow: [__dirname, desktopRoot] },
  },
});
