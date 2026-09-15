import { describe, it, expect } from "vitest";
import { isAnswerToInteractiveBlock } from "../interactiveAnswers";
import type { ChatMessage } from "../../types";

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

describe("isAnswerToInteractiveBlock", () => {
  it("is false for an ordinary back-and-forth with no interactive block", () => {
    const messages = [msg("user", "hi"), msg("assistant", "hello!"), msg("user", "how are you")];
    expect(isAnswerToInteractiveBlock(messages, 2)).toBe(false);
  });

  it("is true for the user message right after an options block", () => {
    const messages = [msg("assistant", '```options\n{"question":"Pick one","options":["A","B"]}\n```'), msg("user", "A")];
    expect(isAnswerToInteractiveBlock(messages, 1)).toBe(true);
  });

  it("is true for the user message right after a paper-plan block", () => {
    const messages = [msg("assistant", '```paper-plan\n{"title":"T"}\n```'), msg("user", "Looks good — go ahead and write it.")];
    expect(isAnswerToInteractiveBlock(messages, 1)).toBe(true);
  });

  it("is true for the user message right after a step-check block", () => {
    const messages = [msg("assistant", '```step-check\n{"prompt":"Try it"}\n```'), msg("user", "My attempt: $x=2$")];
    expect(isAnswerToInteractiveBlock(messages, 1)).toBe(true);
  });

  it("is true for the user message right after a checkpoint block", () => {
    const messages = [msg("assistant", '```checkpoint\n{"question":"Why?"}\n```'), msg("user", "Because of X")];
    expect(isAnswerToInteractiveBlock(messages, 1)).toBe(true);
  });

  it("is false when the preceding message has no interactive block, even with normal prose", () => {
    const messages = [msg("assistant", "Here's a plain explanation with no block."), msg("user", "thanks")];
    expect(isAnswerToInteractiveBlock(messages, 1)).toBe(false);
  });

  it("is false for the assistant's own reply that follows an answered block", () => {
    const messages = [
      msg("assistant", '```checkpoint\n{"question":"Why?"}\n```'),
      msg("user", "Because of X"),
      msg("assistant", "Correct!"),
    ];
    expect(isAnswerToInteractiveBlock(messages, 2)).toBe(false);
  });

  it("is false for a later, unrelated user message even if an earlier block exists further back", () => {
    const messages = [
      msg("assistant", '```checkpoint\n{"question":"Why?"}\n```'),
      msg("user", "Because of X"),
      msg("assistant", "Correct! Anything else?"),
      msg("user", "no thanks"),
    ];
    expect(isAnswerToInteractiveBlock(messages, 3)).toBe(false);
  });

  it("is false for index 0 (no preceding message at all)", () => {
    expect(isAnswerToInteractiveBlock([msg("user", "hi")], 0)).toBe(false);
  });

  it("is false for an out-of-range index", () => {
    const messages = [msg("assistant", '```options\n{}\n```'), msg("user", "A")];
    expect(isAnswerToInteractiveBlock(messages, 5)).toBe(false);
  });
});
