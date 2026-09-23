// The desktop app's Vite-only ambient types, needed because the promo type-checks the
// real desktop components it imports.
interface ImportMeta {
  env: Record<string, string | undefined>;
}
declare module "plotly.js-basic-dist-min";
