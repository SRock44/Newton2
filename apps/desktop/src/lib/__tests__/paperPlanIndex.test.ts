import { describe, it, expect } from "vitest";
import { latestPaperPlanMessageIndex } from "../paperPlanIndex";
import type { ChatMessage } from "../../types";

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

describe("latestPaperPlanMessageIndex", () => {
  it("returns -1 when no message has a paper-plan block", () => {
    const messages = [msg("user", "let's write a paper"), msg("assistant", "sure, on what topic?")];
    expect(latestPaperPlanMessageIndex(messages)).toBe(-1);
  });

  it("returns -1 for an empty message list", () => {
    expect(latestPaperPlanMessageIndex([])).toBe(-1);
  });

  it("finds the index of the only paper-plan block", () => {
    const messages = [msg("user", "go"), msg("assistant", '```paper-plan\n{"title":"T"}\n```')];
    expect(latestPaperPlanMessageIndex(messages)).toBe(1);
  });

  it("prefers the most recent paper-plan block over an earlier one", () => {
    const messages = [
      msg("assistant", '```paper-plan\n{"title":"Old plan"}\n```'),
      msg("user", "actually, revise it"),
      msg("assistant", '```paper-plan\n{"title":"New plan"}\n```'),
    ];
    expect(latestPaperPlanMessageIndex(messages)).toBe(2);
  });

  it("stays at the last paper-plan message even when later messages exist with no plan of their own", () => {
    const messages = [
      msg("assistant", '```paper-plan\n{"title":"The plan"}\n```'),
      msg("user", "Looks good — go ahead and write it."),
      msg("assistant", "Working on it now…"),
    ];
    expect(latestPaperPlanMessageIndex(messages)).toBe(0);
  });
});
