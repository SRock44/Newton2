import { useEffect, useRef, useState } from "react";

interface PlotlyFigureProps {
  json: string;
}

// plotly.js-basic-dist-min ships no type declarations, and it's not worth adding a
// types-only dependency just to describe the few methods we call loosely on JSON we
// already don't otherwise type-check — this is enough to keep the calls honest below.
interface PlotlyModule {
  newPlot: (
    root: HTMLElement,
    data: unknown[],
    layout: Record<string, unknown>,
    config: Record<string, unknown>,
  ) => void;
  // Used by the slider control below to toggle trace visibility client-side (Learn
  // Mode's manipulable plots) — no full re-render, no new network call per drag.
  restyle: (root: HTMLElement, update: Record<string, unknown>, traceIndices?: number[]) => void;
  purge: (root: HTMLElement) => void;
}

/** One entry of the figure spec's optional top-level `sliders` field (see
 * app/tools/visualizer.py's `vary` argument) — `values` is index-aligned with the
 * subset of `data` traces this slider controls, and `active` is which index starts
 * visible (mirroring whichever trace the backend already marked `visible: true`). */
interface FigureSlider {
  label: string;
  values: number[];
  active?: number;
}

interface ParsedFigure {
  data: unknown[];
  layout?: Record<string, unknown>;
  sliders?: FigureSlider[];
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
 * does. This avoids that dependency entirely.
 *
 * When the parsed figure includes a `sliders` field (Learn Mode's manipulable
 * visualization — see app/tools/visualizer.py's `vary` argument), one extra trace per
 * discrete parameter position is already baked into `data`, all but one `visible:
 * false`. A native `<input type="range">` per slider toggles which trace is visible via
 * `Plotly.restyle` as it moves — fully client-side, no re-fetch, no new JS math-
 * evaluation dependency. When `sliders` is absent (every plot before Learn Mode, and
 * every non-`vary` plot_function call after it), rendering is unchanged from before —
 * no extra DOM, no extra network, pixel-identical. */
function PlotlyFigure({ json }: PlotlyFigureProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotlyRef = useRef<PlotlyModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sliders, setSliders] = useState<FigureSlider[] | null>(null);
  const [activeIndices, setActiveIndices] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    let plotted = false;

    let parsed: ParsedFigure;
    try {
      parsed = JSON.parse(json);
      if (!Array.isArray(parsed.data)) throw new Error("figure has no data");
    } catch {
      setError("Couldn't render this chart (invalid figure data).");
      return;
    }

    const parsedSliders = Array.isArray(parsed.sliders) && parsed.sliders.length > 0 ? parsed.sliders : null;
    setSliders(parsedSliders);
    setActiveIndices(parsedSliders ? parsedSliders.map((s) => s.active ?? 0) : []);

    const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const fontColor = isDark ? "#f1f1f4" : "#1a1b23";
    const gridColor = isDark ? "#34353f" : "#e1e3ea";

    loadPlotly().then((Plotly) => {
      if (cancelled || !containerRef.current) return;
      plotlyRef.current = Plotly;
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

  /** Toggles which single trace within this slider's own contiguous block of `data` is
   * visible — sliders' trace blocks are laid out back-to-back in the order the backend
   * emitted them, so this slider's block starts right after every earlier slider's. */
  function handleSliderChange(sliderIndex: number, valueIndex: number) {
    if (!sliders) return;
    setActiveIndices((prev) => {
      const next = [...prev];
      next[sliderIndex] = valueIndex;
      return next;
    });

    if (!containerRef.current || !plotlyRef.current) return;
    let offset = 0;
    for (let i = 0; i < sliderIndex; i++) offset += sliders[i].values.length;
    const blockLen = sliders[sliderIndex].values.length;
    const visibility = Array.from({ length: blockLen }, (_, i) => i === valueIndex);
    const traceIndices = Array.from({ length: blockLen }, (_, i) => offset + i);
    plotlyRef.current.restyle(containerRef.current, { visible: visibility }, traceIndices);
  }

  if (error) {
    return <div className="plotly-figure plotly-figure--error">{error}</div>;
  }

  return (
    <>
      <div className="plotly-figure" ref={containerRef} style={{ width: "100%", height: "360px" }} />
      {sliders && (
        <div className="plotly-figure__sliders">
          {sliders.map((slider, sliderIndex) => {
            const activeIndex = activeIndices[sliderIndex] ?? 0;
            return (
              <div className="plotly-figure__slider-row" key={`${slider.label}-${sliderIndex}`}>
                <span className="plotly-figure__slider-label">{slider.label}</span>
                <input
                  type="range"
                  min={0}
                  max={slider.values.length - 1}
                  step={1}
                  value={activeIndex}
                  aria-label={`${slider.label} slider`}
                  onChange={(e) => handleSliderChange(sliderIndex, Number(e.target.value))}
                />
                <span className="plotly-figure__slider-value">
                  {slider.label} = {slider.values[activeIndex]}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default PlotlyFigure;
