import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Bind explicitly to IPv4 loopback rather than leaving Vite to resolve the
    // ambiguous "localhost" default itself -- on this machine that resolution landed
    // on IPv6-only (`::1`), while tauri.conf.json's devUrl ("http://localhost:1420")
    // and the webview's own request both ended up on IPv4, producing a real, 100%-
    // reproducible ERR_CONNECTION_REFUSED (confirmed via `netstat`: Vite listening only
    // on ::1, zero IPv4 listener on port 1420, `curl http://127.0.0.1:1420` refused
    // every single time). host || false (Vite's own scaffolded default) is exactly
    // what produced that ambiguity; pinning it removes the ambiguity outright.
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
