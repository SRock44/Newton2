import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MessageContent from "../MessageContent";
import PlotlyFigure from "../PlotlyFigure";

const newPlot = vi.fn();
const purge = vi.fn();

// jsdom has no canvas/WebGL, so we don't want a real Plotly render in tests — only
// that this component drives the (mocked) API correctly with the parsed figure data.
vi.mock("plotly.js-basic-dist-min", () => ({
  default: { newPlot, purge },
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
