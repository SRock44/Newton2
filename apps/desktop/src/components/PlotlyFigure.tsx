import { useEffect, useRef, useState } from "react";

interface PlotlyFigureProps {
  json: string;
}

// plotly.js-basic-dist-min ships no type declarations, and it's not worth adding a
// types-only dependency just to describe two methods we call loosely on JSON we
// already don't otherwise type-check — this is enough to keep the calls honest below.
interface PlotlyModule {
  newPlot: (
    root: HTMLElement,
    data: unknown[],
    layout: Record<string, unknown>,
    config: Record<string, unknown>,
  ) => void;
  purge: (root: HTMLElement) => void;
}

async function loadPlotly(): Promise<PlotlyModule> {
  const mod = (await import("plotly.js-basic-dist-min")) as unknown as {
    default?: PlotlyModule;
  } & PlotlyModule;
  return mod.default ?? mod;
}

/** Renders a Plotly figure spec (as produced by the backend's `plot_function` tool)
 * using plotly.js-basic-dist-min's imperative API directly — deliberately not the
 * `react-plotly.js` wrapper package, which hard-depends on the *full* plotly.js
 * (pulling in map chart types via `maplibre-gl`, which has a known critical XSS
 * advisory) even when you only ever render simple line/scatter plots like this app
 * does. This avoids that dependency entirely. */
function PlotlyFigure({ json }: PlotlyFigureProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let plotted = false;

    let parsed: { data: unknown[]; layout?: Record<string, unknown> };
    try {
      parsed = JSON.parse(json);
      if (!Array.isArray(parsed.data)) throw new Error("figure has no data");
    } catch {
      setError("Couldn't render this chart (invalid figure data).");
      return;
    }

    const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const fontColor = isDark ? "#f1f1f4" : "#1a1b23";
    const gridColor = isDark ? "#34353f" : "#e1e3ea";

    loadPlotly().then((Plotly) => {
      if (cancelled || !containerRef.current) return;
      Plotly.newPlot(
        containerRef.current,
        parsed.data,
        {
          autosize: true,
          margin: { t: 36, r: 16, b: 40, l: 48 },
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          font: { color: fontColor },
          xaxis: { gridcolor: gridColor, zerolinecolor: gridColor },
          yaxis: { gridcolor: gridColor, zerolinecolor: gridColor },
          ...parsed.layout,
        },
        { displaylogo: false, responsive: true },
      );
      plotted = true;
    });

    return () => {
      cancelled = true;
      if (plotted && containerRef.current) {
        loadPlotly().then((Plotly) => {
          if (containerRef.current) Plotly.purge(containerRef.current);
        });
      }
    };
  }, [json]);

  if (error) {
    return <div className="plotly-figure plotly-figure--error">{error}</div>;
  }

  return <div className="plotly-figure" ref={containerRef} style={{ width: "100%", height: "360px" }} />;
}

export default PlotlyFigure;
