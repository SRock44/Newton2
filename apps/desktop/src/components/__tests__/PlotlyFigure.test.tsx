import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import MessageContent from "../MessageContent";
import PlotlyFigure from "../PlotlyFigure";

const newPlot = vi.fn();
const purge = vi.fn();
const restyle = vi.fn();

// jsdom has no canvas/WebGL, so we don't want a real Plotly render in tests — only
// that this component drives the (mocked) API correctly with the parsed figure data.
vi.mock("plotly.js-basic-dist-min", () => ({
  default: { newPlot, purge, restyle },
}));

describe("PlotlyFigure", () => {
  it("calls Plotly.newPlot with the parsed data and layout", async () => {
    const spec = {
      data: [{ x: [1, 2, 3], y: [1, 4, 9], type: "scatter", mode: "lines" }],
      layout: { title: "y = x^2" },
    };
    render(<PlotlyFigure json={JSON.stringify(spec)} />);

    await waitFor(() => expect(newPlot).toHaveBeenCalled());
    const [, data, layout] = newPlot.mock.calls[0];
    expect(data).toEqual(spec.data);
    expect(layout.title).toBe("y = x^2");
  });

  it("shows an error state for invalid JSON instead of throwing", () => {
    render(<PlotlyFigure json="not valid json" />);
    expect(screen.getByText(/couldn't render this chart/i)).toBeInTheDocument();
    expect(newPlot).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything());
  });

  it("shows an error state for JSON with no data array", () => {
    render(<PlotlyFigure json={JSON.stringify({ layout: {} })} />);
    expect(screen.getByText(/couldn't render this chart/i)).toBeInTheDocument();
  });
});

describe("PlotlyFigure sliders (Learn Mode's manipulable visualization)", () => {
  const SLIDER_SPEC = {
    data: [
      { x: [-1, 0, 1], y: [1, 0, 1], type: "scatter", mode: "lines", name: "a = 1", visible: false },
      { x: [-1, 0, 1], y: [2, 0, 2], type: "scatter", mode: "lines", name: "a = 2", visible: true },
      { x: [-1, 0, 1], y: [3, 0, 3], type: "scatter", mode: "lines", name: "a = 3", visible: false },
    ],
    layout: { title: "y = a*x^2" },
    sliders: [{ label: "a", values: [1, 2, 3], active: 1 }],
  };

  it("renders a range input for the slider, starting at the active index", async () => {
    render(<PlotlyFigure json={JSON.stringify(SLIDER_SPEC)} />);
    await waitFor(() => expect(newPlot).toHaveBeenCalled());

    const slider = screen.getByRole("slider", { name: /a slider/i }) as HTMLInputElement;
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "2");
    expect(slider.value).toBe("1");
    expect(screen.getByText("a = 2")).toBeInTheDocument();
  });

  it("moving the slider calls Plotly.restyle to toggle trace visibility, not newPlot again", async () => {
    render(<PlotlyFigure json={JSON.stringify(SLIDER_SPEC)} />);
    await waitFor(() => expect(newPlot).toHaveBeenCalled());
    const newPlotCallsBefore = newPlot.mock.calls.length;

    const slider = screen.getByRole("slider", { name: /a slider/i });
    fireEvent.change(slider, { target: { value: "2" } });

    await waitFor(() => expect(restyle).toHaveBeenCalled());
    const [, update, traceIndices] = restyle.mock.calls[restyle.mock.calls.length - 1];
    expect(update).toEqual({ visible: [false, false, true] });
    expect(traceIndices).toEqual([0, 1, 2]);
    expect(newPlot.mock.calls.length).toBe(newPlotCallsBefore); // no full re-render
    expect(screen.getByText("a = 3")).toBeInTheDocument();
  });

  it("renders no slider controls and behaves exactly as before when sliders is absent", async () => {
    const spec = { data: [{ x: [1, 2, 3], y: [1, 4, 9] }], layout: {} };
    render(<PlotlyFigure json={JSON.stringify(spec)} />);
    await waitFor(() => expect(newPlot).toHaveBeenCalled());

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});

describe("MessageContent + plotly-figure code fence", () => {
  it("renders a plotly-figure fenced block as a chart, not a plain code block", async () => {
    const spec = { data: [{ x: [0, 1], y: [0, 1] }] };
    const content = "```plotly-figure\n" + JSON.stringify(spec) + "\n```";
    const { container } = render(<MessageContent content={content} />);

    await waitFor(() => expect(newPlot).toHaveBeenCalled());
    expect(container.querySelector(".plotly-figure")).toBeInTheDocument();
    // a real code block would have a copy button and a language label; this shouldn't.
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    expect(screen.queryByText("plotly-figure")).not.toBeInTheDocument();
  });
});
