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
    // port happens to be free") so the backend's CORS allowlist
    // (services/api/app/core/config.py's cors_allow_origins) can name one fixed local
    // dev origin instead of needing CORS_ALLOW_ORIGINS set by hand for every dev machine.
    port: 5173,
    // Vite refuses to serve files outside the project root by default (a real security
    // boundary for anything serving someone else's files) — apps/web's entire premise is
    // serving apps/desktop/src's own files, so that root has to be explicitly allowed.
    fs: { allow: [__dirname, desktopRoot] },
  },
});
