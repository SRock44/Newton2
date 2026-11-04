import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "../desktop");

// Mirrors vite.config.ts's alias — see its comment for why only react/react-dom need it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(desktopRoot, "node_modules/react"),
      "react-dom": path.resolve(desktopRoot, "node_modules/react-dom"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
