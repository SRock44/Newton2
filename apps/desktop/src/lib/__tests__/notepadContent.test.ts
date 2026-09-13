import { describe, it, expect } from "vitest";
import { latestMathStepsJson } from "../notepadContent";
import type { ChatMessage } from "../../types";

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

describe("latestMathStepsJson", () => {
  it("returns null when no message has a math-steps block", () => {
    const messages = [msg("user", "solve for x"), msg("assistant", "x = 4")];
    expect(latestMathStepsJson(messages)).toBeNull();
  });

  it("extracts the JSON body of a math-steps fenced block", () => {
    const messages = [
      msg("assistant", '```math-steps\n{"steps": ["Step one", "Step two"]}\n```'),
    ];
    expect(latestMathStepsJson(messages)).toBe('{"steps": ["Step one", "Step two"]}');
  });

  it("prefers the most recent message's block over an earlier one", () => {
    const messages = [
      msg("assistant", '```math-steps\n{"steps": ["old"]}\n```'),
      msg("user", "another one"),
      msg("assistant", '```math-steps\n{"steps": ["new"]}\n```'),
    ];
    expect(latestMathStepsJson(messages)).toBe('{"steps": ["new"]}');
  });

  it("within one message, prefers the last block over an earlier one", () => {
    const content =
      '```math-steps\n{"steps": ["first"]}\n```\nsome text\n```math-steps\n{"steps": ["second"]}\n```';
    expect(latestMathStepsJson([msg("assistant", content)])).toBe('{"steps": ["second"]}');
  });

  it("skips a streaming/partial message with no closing fence and falls back to an earlier complete one", () => {
    const messages = [
      msg("assistant", '```math-steps\n{"steps": ["complete"]}\n```'),
      msg("assistant", '```math-steps\n{"steps": ["still strea'),
    ];
    expect(latestMathStepsJson(messages)).toBe('{"steps": ["complete"]}');
  });

  it("ignores empty message list", () => {
    expect(latestMathStepsJson([])).toBeNull();
  });
});
