// plotly.js-basic-dist-min ships no type declarations of its own. We only ever touch
// it through the narrow, hand-written `PlotlyModule` interface in PlotlyFigure.tsx, so
// this just needs to stop the "implicitly any" error at the import site, not describe
// its real (large) API surface.
declare module "plotly.js-basic-dist-min";
