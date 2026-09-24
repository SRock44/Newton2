import { describe, it, expect } from "vitest";
import { fallbackTopic, selectionActivityLabel } from "../selectionActivity";

describe("selectionActivityLabel", () => {
  it("Ask Newton names the topic once it's known", () => {
    expect(selectionActivityLabel({ action: "ask", topic: "the SOR iteration gap", working: false })).toBe(
      "Asking Newton about the SOR iteration gap",
    );
  });

  it("Ask Newton reads 'your selection…' until the topic label arrives", () => {
    expect(selectionActivityLabel({ action: "ask", topic: null, working: false })).toBe(
      "Asking Newton about your selection…",
    );
  });

  it.each([
    ["explain", "Explaining"],
    ["define", "Defining"],
    ["summarize", "Summarizing"],
  ] as const)("%s reads as an in-progress verb while Newton works", (action, verb) => {
    expect(selectionActivityLabel({ action, topic: "spectral radius", working: true })).toBe(
      `${verb} spectral radius…`,
    );
    expect(selectionActivityLabel({ action, topic: null, working: true })).toBe(`${verb} your selection…`);
  });

  it.each([
    ["explain", "Newton explained"],
    ["define", "Newton defined"],
    ["summarize", "Newton summarized"],
  ] as const)("%s reads as done once the result is up", (action, phrase) => {
    expect(selectionActivityLabel({ action, topic: "spectral radius", working: false })).toBe(
      `${phrase} spectral radius`,
    );
  });
});

describe("fallbackTopic", () => {
  it("quotes a short highlight whole", () => {
    expect(fallbackTopic("the residual bound")).toBe("“the residual bound”");
  });

  it("quotes only the first six words of a long one, with an ellipsis", () => {
    expect(fallbackTopic("they are systematically larger than the spectral-radius prediction")).toBe(
      "“they are systematically larger than the…”",
    );
  });

  it("collapses whitespace and newlines", () => {
    expect(fallbackTopic("  one\n\n two   three ")).toBe("“one two three”");
  });

  it("never returns an empty quote", () => {
    expect(fallbackTopic("   ")).toBe("your selection");
  });
});
