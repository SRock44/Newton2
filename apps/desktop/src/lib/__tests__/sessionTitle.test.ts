import { describe, it, expect } from "vitest";
import { sessionDisplayTitle } from "../sessionTitle";
import type { ChatSession } from "../../types";

const base: ChatSession = {
  id: "s1",
  title: null,
  status: "active",
  created_at: "2026-09-10T12:00:00Z",
};

describe("sessionDisplayTitle", () => {
  it("prefers the server-provided title when set", () => {
    expect(sessionDisplayTitle({ ...base, title: "Kinematics" })).toBe("Kinematics");
  });

  it("derives a title from the first user message when there is no server title", () => {
    expect(sessionDisplayTitle(base, "What is the second law of thermodynamics?")).toBe(
      "What is the second law of thermodynamics?",
    );
  });

  it("truncates a long first message and adds an ellipsis", () => {
    const long = "a".repeat(80);
    const result = sessionDisplayTitle(base, long);
    expect(result.length).toBeLessThanOrEqual(43);
    expect(result.endsWith("…")).toBe(true);
  });

  it("falls back to a dated placeholder when there's no title or message yet", () => {
    expect(sessionDisplayTitle(base)).toMatch(/^New chat/);
  });
});
