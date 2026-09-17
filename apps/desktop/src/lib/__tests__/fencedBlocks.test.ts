import { describe, it, expect } from "vitest";
import { normalizeFencedBlocks, CUSTOM_BLOCK_LANGUAGES } from "../fencedBlocks";

describe("normalizeFencedBlocks", () => {
  it("repairs the real failure: an opening fence glued to the previous sentence", () => {
    // Verbatim shape of a real assistant message from the deployed backend, where a
    // genuinely-built artifact rendered as raw JSON behind a Copy button.
    const raw =
      "Building it now — this takes a minute or two, so hang tight.```newton-artifact\n" +
      '{"document_id": "7fc7765b", "title": "Projectile Motion", "kind": "interactive"}\n' +
      "```\n\nThere it is —";

    const fixed = normalizeFencedBlocks(raw);
    const fenceLine = fixed.split("\n").find((l) => l.startsWith("```newton-artifact"));
    expect(fenceLine).toBe("```newton-artifact");
    // The prose is preserved, just no longer welded to the fence.
    expect(fixed).toContain("so hang tight.");
    expect(fixed).not.toContain("hang tight.```");
  });

  it("leaves an already-correct block byte-for-byte unchanged", () => {
    const raw = 'Here you go:\n\n```newton-artifact\n{"document_id": "d"}\n```\n\nEnjoy.';
    expect(normalizeFencedBlocks(raw)).toBe(raw);
  });

  it("returns content with no fences untouched", () => {
    const raw = "Just a normal reply with no code in it at all.";
    expect(normalizeFencedBlocks(raw)).toBe(raw);
  });

  it("repairs every custom block language this app dispatches on", () => {
    for (const lang of CUSTOM_BLOCK_LANGUAGES) {
      const raw = `text.\`\`\`${lang}\n{}\n\`\`\``;
      const fixed = normalizeFencedBlocks(raw);
      expect(fixed.split("\n").some((l) => l === "```" + lang)).toBe(true);
    }
  });

  it("does NOT touch ordinary code fences — only this app's own block languages", () => {
    const raw = "run this.```python\nprint(1)\n```";
    expect(normalizeFencedBlocks(raw)).toBe(raw);
    const bare = "see.```\nplain\n```";
    expect(normalizeFencedBlocks(bare)).toBe(bare);
  });

  it("does not match a language that merely starts with a custom one", () => {
    const raw = "x.```optionsomething\n{}\n```";
    expect(normalizeFencedBlocks(raw)).toBe(raw);
  });

  it("repairs several mangled blocks in one message", () => {
    const raw = "a.```options\n{}\n```\nthen b.```checkpoint\n{}\n```";
    const fixed = normalizeFencedBlocks(raw);
    expect(fixed.split("\n").filter((l) => l === "```options" || l === "```checkpoint")).toHaveLength(2);
  });

  it("handles a fence longer than three backticks", () => {
    const raw = "x.````newton-artifact\n{}\n````";
    expect(normalizeFencedBlocks(raw).split("\n").some((l) => l === "````newton-artifact")).toBe(true);
  });
});
