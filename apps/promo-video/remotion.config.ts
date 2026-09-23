import { Config } from "@remotion/cli/config";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpack = require("webpack");

// The promo renders the REAL, unmodified desktop-app components (apps/desktop/src), so
// their bare imports (react-markdown, katex, fontsource, ...) must resolve from the
// desktop app's node_modules, while React itself must be ONE copy shared with Remotion --
// two Reacts is an instant "invalid hook call".
const desktopModules = path.resolve(process.cwd(), "../desktop/node_modules");
const ownModules = path.resolve(process.cwd(), "node_modules");

Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    modules: [ownModules, desktopModules, ...(config.resolve?.modules ?? ["node_modules"])],
    alias: {
      ...(config.resolve?.alias ?? {}),
      react: path.join(ownModules, "react"),
      "react-dom": path.join(ownModules, "react-dom"),
    },
  },
  plugins: [
    ...(config.plugins ?? []),
    // The desktop app is a Vite app (`import.meta.env.VITE_API_URL ?? ...`); give
    // webpack an empty env so those defaults apply.
    new webpack.DefinePlugin({ "import.meta.env": "({})" }),
  ],
}));
